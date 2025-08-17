import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { authenticateToken } from '../middleware/auth.js';

// Load environment variables
dotenv.config();

const router = express.Router();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Test OpenAI API connection
router.get('/test-connection', async (req, res) => {
  try {
    console.log('Testing OpenAI API connection...');
    
    // Simple test with a basic completion
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: "Say 'Hello! OpenAI API is working correctly.' if you can receive this message."
        }
      ],
      max_tokens: 50,
      temperature: 0.1
    });

    const response = completion.choices[0]?.message?.content || 'No response received';

    res.json({
      status: 'success',
      message: 'OpenAI API connection successful',
      ai_response: response,
      usage: completion.usage,
      model: completion.model,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('OpenAI API test failed:', error.message);
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to connect to OpenAI API',
      error: error.message,
      details: {
        hasApiKey: !!process.env.OPENAI_API_KEY,
        apiKeyLength: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0
      }
    });
  }
});

// Test file analysis for folder organization
router.post('/analyze-file', authenticateToken, async (req, res) => {
  try {
    const { filename, fileType, userContext } = req.body;
    
    if (!filename) {
      return res.status(400).json({
        status: 'error',
        message: 'Filename is required'
      });
    }

    console.log(`Analyzing file: ${filename} for user: ${req.user.email}`);

    // Create a prompt for file organization analysis
    const prompt = `You are a document organization expert. Analyze this file and suggest the best folder structure for organization.

File Details:
- Filename: ${filename}
- File Type: ${fileType || 'unknown'}
- User: ${req.user.given_name} ${req.user.family_name} (${req.user.email})
- Upload Date: ${new Date().toISOString().split('T')[0]}
${userContext ? `- Business Context: ${userContext}` : ''}

Based on the filename and context, suggest a logical folder path structure. Consider:
- Document type (tax forms, business documents, personal, contracts, etc.)
- Year (if applicable)
- Business/client name (if applicable)
- Document category

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
          content: "You are a professional document organization assistant. Always respond with valid JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 300,
      temperature: 0.2
    });

    const aiResponse = completion.choices[0]?.message?.content || '{}';
    
    try {
      // Parse the AI response as JSON
      const analysis = JSON.parse(aiResponse);
      
      res.json({
        status: 'success',
        message: 'File analysis completed',
        file_info: {
          filename: filename,
          fileType: fileType,
          userEmail: req.user.email
        },
        ai_analysis: analysis,
        usage: completion.usage,
        timestamp: new Date().toISOString()
      });

    } catch (parseError) {
      // If JSON parsing fails, return the raw response
      res.json({
        status: 'partial_success',
        message: 'File analysis completed but response format needs adjustment',
        file_info: {
          filename: filename,
          fileType: fileType,
          userEmail: req.user.email
        },
        raw_ai_response: aiResponse,
        usage: completion.usage,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('File analysis failed:', error.message);
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to analyze file',
      error: error.message
    });
  }
});

router.post('/analyze-files', authenticateToken, async (req, res) => {
  try {
    const { files, userContext } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'At least one file is required'
      });
    }

    console.log(`Analyzing ${files.length} files for user: ${req.user.email}`);

    // Build prompt with all files
    const fileDetails = files.map((f, idx) => 
    `File ${idx + 1}:
    - Filename: ${f.filename}
    - File Type: ${f.fileType || 'unknown'}`
        ).join("\n\n");

    const prompt = `You are a document organization expert. Analyze the following files and suggest the best folder structure for each file.

    User: ${req.user.given_name} ${req.user.family_name} (${req.user.email})
    Upload Date: ${new Date().toISOString().split('T')[0]}
    ${userContext ? `Business Context: ${userContext}` : ''}

    Files:
    ${fileDetails}

    For EACH file, respond with an entry inside a JSON array.
    The response MUST be valid JSON in this format:
    [
      {
        "filename": "original_filename.ext",
        "suggested_path": "/Main_Category/Sub_Category/Year_or_Details/",
        "category": "tax_document|business_document|personal_document|contract|other",
        "confidence": 0.95,
        "reasoning": "Brief explanation of why this folder structure was chosen",
        "auto_create": true
      }
    ]`;

    // Call OpenAI once
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a professional document organization assistant. Always respond with valid JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 1000,
      temperature: 0.2
    });

    const aiResponse = completion.choices[0]?.message?.content || '[]';

    let analyses;
    try {
      analyses = JSON.parse(aiResponse);
    } catch (err) {
      return res.json({
        status: 'partial_success',
        message: 'AI responded but JSON parsing failed',
        raw_ai_response: aiResponse,
        timestamp: new Date().toISOString()
      });
    }

    // Validate each analysis has filename
    const validated = files.map(file => {
      const match = analyses.find(a => a.filename === file.filename);
      return {
        filename: file.filename,
        fileType: file.fileType,
        analysis: match || null
      };
    });

    res.json({
      status: 'success',
      message: 'File analyses completed',
      analyses: validated,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Batch file analysis failed:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to analyze files',
      error: error.message
    });
  }
});


// Test folder structure generation
router.post('/suggest-folders', authenticateToken, async (req, res) => {
  try {
    const { documentTypes } = req.body;
    
    console.log(`Generating folder structure for user: ${req.user.email}`);

    const prompt = `Create a comprehensive folder structure for a user's document management system.

User: ${req.user.given_name} ${req.user.family_name}
Document Types to Consider: ${documentTypes || 'tax documents, business documents, personal documents, contracts'}

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
          content: "You are a professional document organization consultant. Respond with valid JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.3
    });

    const aiResponse = completion.choices[0]?.message?.content || '{}';
    
    try {
      const folderStructure = JSON.parse(aiResponse);
      
      res.json({
        status: 'success',
        message: 'Folder structure generated',
        user_info: {
          name: `${req.user.given_name} ${req.user.family_name}`,
          email: req.user.email
        },
        suggested_structure: folderStructure,
        usage: completion.usage,
        timestamp: new Date().toISOString()
      });

    } catch (parseError) {
      res.json({
        status: 'partial_success',
        message: 'Folder structure generated but needs format adjustment',
        raw_ai_response: aiResponse,
        usage: completion.usage,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Folder structure generation failed:', error.message);
    
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate folder structure',
      error: error.message
    });
  }
});

export default router; 