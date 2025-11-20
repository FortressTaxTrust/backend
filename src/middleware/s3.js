import { S3Client, PutObjectCommand,GetObjectCommand } from '@aws-sdk/client-s3';
import multer from 'multer';
import { PassThrough } from 'stream';

// AWS S3 configuration
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
console.log('AWS S3 client initialized with region:', process.env.AWS_REGION || 'us-east-1');

// // Multer memory storage
const storage = multer.memoryStorage();

const allowedMimeTypes = [
  // images
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  // documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // text
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
];

const multiFileUpload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, 
  },
  fileFilter: (req, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error(`Invalid file type: ${file.originalname}`));
    }
    cb(null, true);
  },
}).array('files', 20);


const getFileFromS3 = async (fileUrl) => {
  try {
    const url = new URL(fileUrl);
    const bucket = url.hostname.split('.')[0]; 
    const key = decodeURIComponent(url.pathname.slice(1)); 

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const s3Response = await s3.send(command);
    const stream = s3Response.Body;

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const fileBuffer = Buffer.concat(chunks);

    return {
      fileName : key,
      buffer: fileBuffer,
      contentType: s3Response.ContentType,
      contentLength: s3Response.ContentLength,
    };
  } catch (error) {
    console.error('Error fetching file from S3:', error);
    throw error;
  }
};

const uploadToS3 = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      console.log('No files found in request');
      return next();
    }

    const uploadedFiles = [];

    for (const file of req.files) {
       const filePath = `fortress documents/${file.originalname}`;

      const command = new PutObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: filePath,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      console.log(`Uploading file to S3: ${file.originalname}`);
      await s3.send(command);

      const fileUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${filePath}`;

      uploadedFiles.push({
        originalName: file.originalname,
        url: fileUrl,
        fieldname: file.fieldname,
        encoding: file.encoding,
        mimetype: file.mimetype,
      });
    }

    req.filesUploaded = uploadedFiles;

    console.log('All files uploaded successfully:', uploadedFiles);
    next();
  } catch (error) {
    console.error('S3 upload error:', error);
    res.status(500).json({
      message: 'Failed to upload files to S3',
      error: error.message,
      details: error.stack,
    });
  }
};

export { uploadToS3, multiFileUpload , getFileFromS3};
