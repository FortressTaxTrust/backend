import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, 
    port: process.env.SMTP_PORT, 
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Optional test
transporter.verify((error, success) => {
  if (error) {
    console.log("SMTP Connect Error:", error);
  } else {
    console.log("SMTP is ready to send messages");
  }
});

export const sendMail = async ({ to, subject, html, text }) => {
  return await transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
};
