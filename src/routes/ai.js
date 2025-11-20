import express from "express";
import OpenAI, { toFile } from "openai";
import dotenv from "dotenv";
import { authenticateToken } from "../middleware/auth.js";
import { getFolderByName,createFolder,uploadFile,getWorkDrive} from './zoho.js';
import { uploadToS3, multiFileUpload ,getFileFromS3} from "../middleware/s3.js";
import  PgHelper  from "../utils/pgHelpers.js"

// Load environment variables
dotenv.config();

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Test OpenAI API connection
router.get("/test-connection", async (req, res) => {
  try {
    console.log("Testing OpenAI API connection...");

    // Simple test with a basic completion
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content:
            "Say 'Hello! OpenAI API is working correctly.' if you can receive this message.",
        },
      ],
      max_tokens: 50,
      temperature: 0.1,
    });

    const response =
      completion.choices[0]?.message?.content || "No response received";

    res.json({
      status: "success",
      message: "OpenAI API connection successful",
      ai_response: response,
      usage: completion.usage,
      model: completion.model,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("OpenAI API test failed:", error.message);

    res.status(500).json({
      status: "error",
      message: "Failed to connect to OpenAI API",
      error: error.message,
      details: {
        hasApiKey: !!process.env.OPENAI_API_KEY,
        apiKeyLength: process.env.OPENAI_API_KEY
          ? process.env.OPENAI_API_KEY.length
          : 0,
      },
    });
  }
});

// Test file analysis for folder organization
router.post("/analyze-file", authenticateToken, async (req, res) => {
  try {
    const { filename, fileType, userContext } = req.body;

    if (!filename) {
      return res.status(400).json({
        status: "error",
        message: "Filename is required",
      });
    }

    console.log(`Analyzing file: ${filename} for user: ${req.user.email}`);

    // Create a prompt for file organization analysis
    const prompt = `You are a professional tax document classification assistant. You receive uploaded files (names and/or text content) and must decide where they belong in a taxpayer’s Zoho WorkDrive folder structure. Always classify based on U.S. federal, state, and trust tax rules.

1. Folder Structure Rules

Each Account (Individual, Business, or Trust) has a Year folder (e.g., 2023, 2024). Inside each year folder, there are seven standard folders, each with defined subfolders:

01 – Tax Return & Extensions

Drafts – early versions before filing.

Final Filed Return – signed and submitted returns (1040, 1065, 1120, 1041, etc.).

E-File Confirmations – IRS/state acknowledgments.

Federal Extension (Forms 4868, 7004) – extension requests.

State Extensions – state equivalents.

Estimated Tax Vouchers (Q1–Q4) – quarterly estimated payments.

Payment Confirmations – proof of tax payments.

02 – Source Docs (Client-Provided)

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

05 – Engagement & Authority

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

07 – Admin & Internal Notes

Prep checklists.

Internal review notes & comments.

Workpapers for Schedules A/B/D/M-1/M-2.

Depreciation schedules.

Trustee discussions.

Beneficiary distribution logs (Trust).

2. Document Type Mapping

Use these mappings to match documents to folders:

Individual (Forms): 1040, 1040-SR, 1040-X, W-2, 1099 (INT/DIV/MISC/NEC/B/R/G/K), 1098 (Mortgage, Tuition, Loan Interest), 8863 (Education Credits), 8889 (HSAs), 8962 (Premium Tax Credit), FBAR, Form 1116 (Foreign Tax Credit), Form 2555 (Foreign Earned Income).

Business (Forms): 1065, 1120, 1120S, 941, 940, W-9, W-3, 1096, 2553, 2848, 8821, 8300, 4797, 4562, 6252, 8832, 720, Schedule K-2/K-3.

Trust (Forms): 1041, K-1 (1041), 5227, 1041-ES, 3520, 3520-A, 2439, 8282/8283, Form 56 (Fiduciary), 8655.

All taxpayers (supporting docs): income docs (W-2, 1099s, SSA-1099, K-1s, rental logs), deduction docs (property tax bills, charitable receipts, EV credit docs), assets/investments (HUD-1, brokerage statements, crypto CSVs), retirement & insurance docs (5498, 1095s, long-term care premiums).

Respond with ONLY a JSON object in this exact format:
{
  "suggested_path": "/Main_Category/Sub_Category/Year_or_Details/",
  "category": "tax_document|business_document|personal_document|contract|other",
  "confidence": 0.95,
  "reasoning": "Brief explanation of why this folder structure was chosen",
  "auto_create": true
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a professional document organization assistant. Always respond with valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 300,
      temperature: 0.2,
    });

    const aiResponse = completion.choices[0]?.message?.content || "{}";

    try {
      // Parse the AI response as JSON
      const analysis = JSON.parse(aiResponse);

      res.json({
        status: "success",
        message: "File analysis completed",
        file_info: {
          filename: filename,
          fileType: fileType,
          userEmail: req.user.email,
        },
        ai_analysis: analysis,
        usage: completion.usage,
        timestamp: new Date().toISOString(),
      });
    } catch (parseError) {
      // If JSON parsing fails, return the raw response
      res.json({
        status: "partial_success",
        message: "File analysis completed but response format needs adjustment",
        file_info: {
          filename: filename,
          fileType: fileType,
          userEmail: req.user.email,
        },
        raw_ai_response: aiResponse,
        usage: completion.usage,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("File analysis failed:", error.message);

    res.status(500).json({
      status: "error",
      message: "Failed to analyze file",
      error: error.message,
    });
  }
});


// files from form data and multer then upload file to ask open ai for each file
router.post(
  "/analyze-files",
  authenticateToken,
  multiFileUpload, uploadToS3,
  async (req, res) => {
    try {
      console.log("Analyzing files...");

      const { filesUploaded, body, user } = req;
      // const fileData = await getFileFromS3(filesUploaded[0].url)
      // console.log("fileData", fileData)

      if (!filesUploaded || filesUploaded.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
      }

      const accountId = body.accountId || null;
      const userId = user?.sub || null;
      const userContext = body.userContext || null;

      // Build insert data array
      const insertData = filesUploaded.map(file => ({
        file_name: file.originalName,
        file_url: file.url,
        metadata: {
          account_id :accountId,
          user : user,
          user_context  : userContext,
          file : file

        }
      }));

      const data = await PgHelper.insertMany("documents", insertData)
      res.json({
        message: "Files analyzed and saved successfully",
        filesInserted: insertData.length,
        data: data
      });

    } catch (err) {
      console.error("Analyze files error:", err);
      res.status(500).json({
        message: "Internal server error",
        error: err.message
      });
    }
  }
);


// router.post(
//   "/analyze-files/",
//   authenticateToken,
//   multiFileUpload,
//   async (req, res) => {
//     try {
//       console.log("Analyzing files...");
//       const userContext = req.body.userContext || null;
//       const accountId = req.body.accountId;

//       if (!req.files || req.files.length === 0) {
//         return res.status(400).json({
//           status: "error",
//           message: "At least one file is required",
//         });
//       }

//       const invalidFiles = req.files.filter(
//         (file) => !allowedMimeTypes.includes(file.mimetype)
//       );
//       if (invalidFiles.length > 0) {
//         return res.status(400).json({
//           status: "error",
//           message: "Invalid file types",
//           invalid_files: invalidFiles.map((file) => file.originalname),
//         });
//       }

//       console.log(
//         `Analyzing ${req.files.length} files for user: ${req.user.email}`
//       );



//       const analyses = [];

//       // 🔹 Process each file
//       for (const f of req.files) {
//         console.log(`Uploading: ${f.originalname}`);

//         // Convert buffer to OpenAI File object using toFile
//         const openaiFile = await toFile(f.buffer, f.originalname);

//         // Upload file
//         const filedata = await openai.files.create({
//           file: openaiFile,
//           purpose: "assistants",
//         });

//         // console.log("✅ File uploaded to OpenAI:", filedata);

//         // const filedata = {
//         //     object: 'file',
//         //     id: 'file-XnfvksSgR5hJTx9fLnSBYQ',
//         //     purpose: 'assistants',
//         //     filename: 'Two Trust 2024 form 1041 As Filed (Gov).pdf',
//         //     bytes: 164475,
//         //     created_at: 1761156348,
//         //     expires_at: null,
//         //     status: 'processed',
//         //     status_details: null
//         //   }
//         // Ask GPT-4o-mini to analyze file
//         const completion = await openai.chat.completions.create({
//           model: "gpt-4o-mini",
//           messages: [
//             {
//               role: "system",
//               content: prompt,
//             },
//             {
//               role: "user",
//               content: [
//                 {
//                   type: "text",
//                   text: `Analyze this file and suggest folder structure.
//                   User: ${req.user?.given_name || "Unknown"} ${
//                     req.user?.family_name || ""
//                   }
//                   Upload Date: ${new Date().toISOString().split("T")[0]}
//                   ${userContext ? `Business Context: ${userContext}` : ""}

//                   Respond with JSON only.`,
//                 },
//                 {
//                   file: {
//                     filename: filedata.originalname,
//                     file_id: filedata.id,
//                   },
//                   type: "file",
//                 },
//               ],
//             },
//           ],
//           max_tokens: 800,
//           temperature: 0.2,
//         });

//         let aiResponse = completion.choices[0]?.message?.content || "{}";
//         aiResponse = aiResponse.replace(/```json|```/g, "").trim();

//         let parsed;
//         try {
//           parsed = JSON.parse(aiResponse);
//         } catch (err) {
//           parsed = {
//             filename: f.originalname,
//             error: "AI responded with invalid JSON",
//             raw_ai_response: aiResponse,
//           };
//         }

//         analyses.push({
//           filename: f.originalname,
//           fileType: f.mimetype,
//           fileBuffer: f.buffer,
//           // openaiFileId: uploaded.id, // keep fileId for later retrieval
//           analysis: parsed,
//         });
//       }

//       // console.log("All files analyzed successfully");
//       // console.log("analysis" , analyses)

//       let uploadedFile = [];
//       const accountIdsString = accountId.toString();
//       const response = await getWorkDrive(accountIdsString);
//       const WorkDrives = response.map((account) => {
//         const link = account.easyworkdriveforcrm__Workdrive_Folder_ID_EXT;
//         let folderId = null;
//         if (typeof link === "string" && link.includes("/")) {
//           folderId = link.split("/").pop();
//         }
//         return {
//           id: account.id,
//           folderId,
//         };
//       });
//       let WorkDrive = WorkDrives[0];
//       console.log("WorkDrive Folders:", WorkDrive);
//       for (const analysisItem of analyses) {
//         const suggestedPath = analysisItem.analysis?.suggested_path;
//         if (!suggestedPath) continue;
//         const pathParts = suggestedPath.split("/").filter(Boolean); 
//         console.log(pathParts);
//         for (const folderName of pathParts) {
//           let folder = await getFolderByName(WorkDrive.folderId, folderName);
//           console.log("hecking folder ,", folder);
//           if (!folder) {
//             continue
//             console.log("Folder not found, creating:", folderName);
//             folder = await createFolder(WorkDrive.folderId, folderName);
//             console.log("");
//             console.log("Created folder:", folderName);
//           }
//           WorkDrive.folderId = folder.id; // set parent for next level
//         }

//         // Upload the file to the final folder
//         console.log(
//           "WorkDrive.folderId, analysisItem.fileBuffer, analysisItem.filename",
//           WorkDrive.folderId,
//           analysisItem.fileBuffer,
//           analysisItem.filename
//         );
//         const uploaded = await uploadFile(
//           WorkDrive.folderId,
//           analysisItem.fileBuffer,
//           analysisItem.filename
//         );
//         console.log(
//           "Uploaded file:",
//           analysisItem.filename,
//           "to folder:",
//           WorkDrive.folderId
//         );
//         console.log("uploadedFile ", uploadedFile);
//         uploadedFile.push({
//           filename: analysisItem.filename,
//           fileType: analysisItem.fileType,
//           parent_id: WorkDrive.folderId,
//           fileId: uploaded?.id,
//         });
//       }
//       res.json({
//         status: "success",
//         message: "File analyses completed",
//         uploadedFile,
//         timestamp: new Date().toISOString(),
//       });
//     } catch (error) {
//       console.error("Batch file analysis failed:", error);
//       res.status(500).json({
//         status: "error",
//         message: "Failed to analyze files",
//         error: error.message,
//       });
//     }
//   }
// );

// Test folder structure generation

router.post("/suggest-folders", authenticateToken, async (req, res) => {
  try {
    const { documentTypes } = req.body;

    console.log(`Generating folder structure for user: ${req.user.email}`);

    const prompt = `Create a comprehensive folder structure for a user's document management system.

User: ${req.user.given_name} ${req.user.family_name}
Document Types to Consider: ${
      documentTypes ||
      "tax documents, business documents, personal documents, contracts"
    }

Create a logical, hierarchical folder structure that would work well for document organization. Include common categories like:
- Tax documents (by year and form type)
- Business documents (by company/client)
- Personal documents (by category)
- Contracts and legal documents
- Financial documents

Respond with a JSON array of folder paths:
{
  "folder_structure": [
    "/Tax_Documents/2024/W2_Forms/",
    "/Tax_Documents/2024/1099_Forms/",
    "/Business_Documents/ClientA/Contracts/",
    "/Personal_Documents/Insurance/",
    etc.
  ],
  "description": "Brief description of the organization system"
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a professional document organization consultant. Respond with valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    const aiResponse = completion.choices[0]?.message?.content || "{}";

    try {
      const folderStructure = JSON.parse(aiResponse);

      res.json({
        status: "success",
        message: "Folder structure generated",
        user_info: {
          name: `${req.user.given_name} ${req.user.family_name}`,
          email: req.user.email,
        },
        suggested_structure: folderStructure,
        usage: completion.usage,
        timestamp: new Date().toISOString(),
      });
    } catch (parseError) {
      res.json({
        status: "partial_success",
        message: "Folder structure generated but needs format adjustment",
        raw_ai_response: aiResponse,
        usage: completion.usage,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("Folder structure generation failed:", error.message);

    res.status(500).json({
      status: "error",
      message: "Failed to generate folder structure",
      error: error.message,
    });
  }
});

export default router;
