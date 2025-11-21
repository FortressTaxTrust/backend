import cron from "node-cron";
import PgHelper from "../utils/pgHelpers.js";
import { uploadToS3, multiFileUpload ,getFileFromS3} from "../middleware/s3.js";
import { getFolderByName,createFolder,uploadFile,getWorkDrive} from '../routes/zoho.js';
import OpenAI, { toFile } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const prompt = `You are a professional tax document classification assistant. You receive uploaded files (names and/or text content) and must decide where they belong in a taxpayer’s Zoho WorkDrive folder structure. Always classify based on U.S. federal, state, and trust tax rules.
	1. Folder Structure Rules

	Each Zoho Account has a Year folder (e.g., 2023, 2024). Inside each year folder, there are seven standard subfolders, each with defined parameters of what kinds of documents should be included in that folder after upload:

	01 – Tax Returns & Extensions

	Drafts – early versions before filing.

	Final Filed Return – signed and submitted returns (1040, 1065, 1120, 1041, etc.).

	E-File Confirmations – IRS/state acknowledgments.

	Federal Extension (Forms 4868, 7004) – extension requests.

	State Extensions – state equivalents.

	Estimated Tax Vouchers (Q1–Q4) – quarterly estimated payments.

	Payment Confirmations – proof of tax payments.

	02 – Source Documents

	W-2s – employee wage statements.

	1099s (INT, DIV, MISC, NEC, K, R, B, G, K-1) – contractor, investment, or retirement income.

	K-1s – pass-through entity income.

	Mortgage/1098 – mortgage interest.

	Brokerage / Investment Statements – stocks, bonds, crypto CSVs.

	Foreign Assets (FBAR / 8938) – offshore accounts.

	Education / HSA / Medical Docs – 1098-T, 1098-E, HSA forms.

	Charitable Contributions – receipts and letters.

	Other Supporting Docs – anything else relevant.

	03 – Tax Planning & Projections

	Withholding Reviews.

	IRA / Roth comparisons.

	Optimization memos.

	Shareholder compensation or dividend strategies (Business).

	Trust DNI projections and distribution strategies (Trust).

	04 – IRS & State Correspondence

	Notices – audit letters, penalties, CP2000, etc.

	Responses – prepared replies.

	Audit Materials / Filing Proofs / Payment Proofs – supporting docs.

	Beneficiary Letters (Trust).

	05 – Engagement & Authority Documents	

	Engagement Letters (signed scope agreements).

	E-File Authorization (Form 8879 / Fiduciary 8879).

	Power of Attorney (Forms 2848, 8821, 56 for trusts).

	Secretary of State filings (Business).

	06 – Spreadsheets & Excel Files

	Client Excel summaries.

	Sale of asset logs.

	Capital account tracking.

	Inventory valuation.

	Basis calculations.

	Trust ledger.

	07 – Admin & Internal Files

	Prep checklists.

	Internal review notes & comments.

	Workpapers for Schedules A/B/D/M-1/M-2.

	Depreciation schedules.

	Trustee discussions.

	Beneficiary distribution logs (Trust).
	If you are at least 95% confident that the document you are examining does not fit within any of the predefined subfolders you have to choose from then use the Admin & Internal Files folder as a catch-all destination for that file.  

	2. Document Type Mapping

	Use these mappings to match documents to folders:

	Individual (Forms): 1040, 1040-SR, 1040-X, W-2, 1099 (INT/DIV/MISC/NEC/B/R/G/K), 1098 (Mortgage, Tuition, Loan Interest), 8863 (Education Credits), 8889 (HSAs), 8962 (Premium Tax Credit), FBAR, Form 1116 (Foreign Tax Credit), Form 2555 (Foreign Earned Income), etc

	Business (Forms): 1065, 1120, 1120S, 941, 940, W-9, W-3, 1096, 2553, 2848, 8821, 8300, 4797, 4562, 6252, 8832, 720, Schedule K-2/K-3, etc

	Trust (Forms): 1041, K-1 (1041), 5227, 1041-ES, 3520, 3520-A, 2439, 8282/8283, Form 56 (Fiduciary), 8655, etc

	All taxpayers (supporting docs): income docs (W-2, 1099s, SSA-1099, K-1s, rental logs), deduction docs (property tax bills, charitable receipts, EV credit docs), assets/investments (HUD-1, brokerage statements, crypto CSVs), retirement & insurance docs (5498, 1095s, long-term care premiums).

	Respond with ONLY a JSON object in this exact format:
	{
	"suggested_path": "Year_or_Details/Main_Category/Sub_Category/",
	"category": "tax_document|business_document|personal_document|contract|other",
	"confidence": 0.95,
	"reasoning": "Brief explanation of why this folder structure was chosen",
	"auto_create": true

}`;
const tableName = "documents";


const uploadDocumentsSchedular = async () => {
  const documents = await PgHelper.select(tableName, { upload_status: "pending", enabled: true });

  for (const document of documents) {
	try {
		if (!document.metadata) continue;

		const { user, account_id, file } = document.metadata;
		console.log("Processing document:", document.file_name);

		// Get file from S3
		const bucketFileData = await getFileFromS3(document.file_url);

		// Convert buffer and upload to OpenAI
		const openaiFile = await toFile(bucketFileData.buffer, document.file_name);
		const filedata = await openai.files.create({ file: openaiFile, purpose: "assistants" });

		// AI analysis
		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [
			{ role: "system", content: prompt },
			{
				role: "user",
				content: [
				{ type:"text", text:`Analyze this file and suggest folder structure.
						User: ${user?.given_name || "Unknown"}
						Upload Date: ${new Date().toISOString().split("T")[0]}
						Respond with JSON only.` },
				{ type: "file", file: { filename: filedata.originalname, file_id: filedata.id } },
				],
			},
			],
			max_tokens: 800,
			temperature: 0.2,
		});

		let aiResponse = completion.choices[0]?.message?.content || "{}";
		aiResponse = aiResponse.replace(/```json|```/g, "").trim();

		let parsed;
		try { parsed = JSON.parse(aiResponse); } 
		catch { parsed = {}; }

		let logData = {
			document_id: document.id,
			filename: document.file_name,
			user_id: user?.id || null,
			account_id: account_id || null,
			suggested_path: parsed?.suggested_path || null,
			category: parsed?.category || null,
			confidence: parsed?.confidence || null,
			reasoning: parsed?.reasoning || null,
			status: "pending",
		};
		const logEntry = await PgHelper.insert("document_upload_logs", logData, { returning: true });

		const accountIdsString = account_id.toString();
		const response = await getWorkDrive(accountIdsString);
		const WorkDrive = response.map(acc => ({
			id: acc.id,
			folderId: acc.easyworkdriveforcrm__Workdrive_Folder_ID_EXT?.split("/").pop() || null,
		}))[0];

		const pathParts = parsed.suggested_path?.split("/").filter(Boolean);

		if (!pathParts || pathParts.length === 0) {
			await PgHelper.update("document_upload_logs", {
			status: "failed",
			reasoning: "No matching folder found",
			updated_at: new Date(),
			}, { id: logEntry.id });
			continue;
		}

		for (const folderName of pathParts) {
			const folder = await getFolderByName(WorkDrive.folderId, folderName);
			if (folder) WorkDrive.folderId = folder.id;
			else {
				await PgHelper.update("document_upload_logs", {
					status: "failed",
					reasoning: "No matching folder found",
					updated_at: new Date(),
				}, { id: logEntry.id });
				console.log(`Document "${document.file_name}" skipped: Folder "${folderName}" not found`);
				break;
			}
		}

		if (!WorkDrive.folderId) continue;

		const uploaded = await uploadFile(WorkDrive.folderId, bucketFileData.buffer, document.file_name);
		
		const fileAttributes = uploaded?.data[0]?.attributes
		console.log("uploaded", fileAttributes)
		if(uploaded && fileAttributes){
			document.metadata = {
				...document.metadata,
				zoho_data: {
					parent_id: fileAttributes.parent_id,
					file_id: fileAttributes?.resource_id,
					permalink: fileAttributes?.Permalink
				}
			}
	  		console.log(`Document "${document.file_name}" uploaded successfully` , uploaded);
			await PgHelper.update("document_upload_logs", { status: "completed",  updated_at: new Date() }, { id: logEntry.id });
			await PgHelper.update("documents", { upload_status: "completed", updated_at: new Date(), metadata  : document.metadata }, { id: document.id });
		} else {
	  		console.log(`Document "${document.file_name}" failed!`, uploaded);
			await PgHelper.update("document_upload_logs", { status: "failed",  updated_at: new Date() }, { id: logEntry.id });
			await PgHelper.update("documents", { upload_status: "failed", updated_at: new Date(), metadata  : document.metadata }, { id: document.id });

		}
	} catch (err) {
	  console.error(`Error processing document "${document.file_name}":`, err);
	  await PgHelper.insert("document_upload_logs", {
		document_id: document.id,
		filename: document.file_name,
		status: "failed",
		error_message: err.message,
		created_at: new Date(),
		updated_at: new Date(),
	  });
	  await PgHelper.update("documents", { upload_status: "failed", updated_at: new Date() }, { id: document.id });
	  continue;
	}
  }
};



export const startScheduler = () => {
	console.log("🕒 Scheduler initialized");
	const threeHrCron = async () => {
		console.log("✅ Scheduled task running at", new Date().toISOString());
		try {
		await uploadDocumentsSchedular();
		} catch (err) {
		console.log("Error in Cron", err);
		}
	};

	threeHrCron()
	// cron.schedule("0 0,12 * * *", threeHrCron);

};
