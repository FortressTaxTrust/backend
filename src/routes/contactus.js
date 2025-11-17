import { Router } from "express";
import { sendMail } from "../utils/mailer.js";

const router = Router();

/**
 * POST /contact
 * Handles contact form submissions
 */
router.post("/", async (req, res) => {
  try {
    const { email, firstName, lastName, description = "", phone = "" } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!firstName) missingFields.push("firstName");
    if (!lastName) missingFields.push("lastName");
    if (!email) missingFields.push("email");

    if (missingFields.length > 0) {
      return res.status(400).json({
        status: "error",
        message: `Missing required field(s): ${missingFields.join(", ")}`
      });
    }

    // Email to admin
    const adminEmailData = {
      to: process.env.SMTP_USER,
      subject: `New Contact Inquiry from ${firstName} ${lastName}`,
      html: `
        <h3>New Contact Form Submission</h3>
        <p><b>Name:</b> ${firstName} ${lastName}</p>
        <p><b>Email:</b> ${email}</p>
        ${phone ? `<p><b>Phone:</b> ${phone}</p>` : ""}
        ${description ? `<p><b>Message:</b></p><p>${description}</p>` : ""}
      `
    };

    await sendMail(adminEmailData);

    // Auto-response to user
    const userEmailData = {
      to: email,
      subject: "Thank you for contacting Fortress Tax and Trust!",
      html: `
        <p>Hello ${firstName},</p>
        <p>Thank you for reaching out. Our support team has received your message and will respond shortly.</p>
        <br>
        <p>Regards,</p>
        <p><b>Fortress Tax and Trust</b></p>
        <p>Visit: <a href="https://fortresstaxandtrust.com">fortresstaxandtrust.com</a></p>
      `
    };

    await sendMail(userEmailData);

    return res.json({
      status: "success",
      message: "Your message has been received. Our team will contact you soon."
    });

  } catch (err) {
    console.error("Contact form error:", err);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong while processing your request.",
      error: err.message || "Unknown error"
    });
  }
});

export default router;
