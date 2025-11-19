import { Router } from "express";
import { sendMail } from "../utils/mailer.js";

const router = Router();

/**
 * POST /contact
 * Handles contact form submissions
 */
router.post("/", async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      description = "",
      number = "",
    } = req.body;

    // Validate required fields
    const missingFields = [];
    if (!firstName) missingFields.push("firstName");
    if (!lastName) missingFields.push("lastName");
    if (!email) missingFields.push("email");

    if (missingFields.length > 0) {
      return res.status(400).json({
        status: "error",
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    // Email to admin
    const adminEmailData = {
      to: process.env.SMTP_USER,
      subject: `New Contact Inquiry from ${firstName} ${lastName}`,
      html: `
      <div style="font-family: Arial, sans-serif; background:#f7f7f7; padding:20px;">
        <div style="max-width:600px; margin:auto; background:#ffffff; padding:25px; border-radius:8px; border:1px solid #e1e1e1;">
          
          <div style="text-align:center; margin-bottom:20px;">
            <!-- Logo Section with Image -->
            <img src="https://fortresstaxandtrust.com/uploads/Logo.svg" 
                alt="Fortress Tax and Trust Logo" 
                style="width:160px;"/>
          </div>

          <h2 style="color:#333;">New Contact Form Submission</h2>

          <p><b>Name:</b> ${firstName} ${lastName}</p>
          <p><b>Email:</b> ${email}</p>
          ${number ? `<p><b>Phone:</b> ${number}</p>` : ""}
          ${description ? `<p><b>Message:</b></p><p>${description}</p>` : ""}

          <hr style="margin:25px 0; border:none; border-top:1px solid #ddd;">

          <p style="font-size:13px; color:#666; text-align:center;">
            Fortress Tax and Trust<br>
            18170 Dallas Pkwy. Suite 303 Dallas, TX 75287<br>
            FAX - 214-975-5594<br>
            Main Line - 469-620-8516<br>
            <a href="https://fortresstaxandtrust.com" style="color:#4A6CF7;">
              fortresstaxandtrust.com
            </a>
          </p>

          </div>
        </div>
        `,
    };

    await sendMail(adminEmailData);

    // Auto-response to user
    const userEmailData = {
      to: email,
      subject: "Thank you for contacting Fortress Tax and Trust!",
      html: `
      <div style="font-family: Arial, sans-serif; background:#f7f7f7; padding:20px;">
        <div style="max-width:600px; margin:auto; background:#ffffff; padding:25px; border-radius:8px; border:1px solid #e1e1e1;">
          
          <div style="text-align:center; margin-bottom:20px;">
            <!-- Logo Section with Image -->
            <img src="https://fortresstaxandtrust.com/uploads/Logo.svg" 
                alt="Fortress Tax and Trust Logo" 
                style="width:160px;"/>
          </div>

          <p>Hello <b>${firstName}</b>,</p>

          <p>
            Thank you for reaching out to Fortress Tax and Trust. 
            We’ve received your message and our support team will get back to you shortly.
          </p>

          <p>If your inquiry is urgent, please feel free to call us.</p>

          <br>
          <p>Regards,</p>
          <p><b>Fortress Tax and Trust</b></p>

          <hr style="margin:25px 0; border:none; border-top:1px solid #ddd;">

          <p style="font-size:13px; color:#666; text-align:center;">
            Fortress Tax and Trust<br>
            18170 Dallas Pkwy. Suite 303 Dallas, TX 75287<br>
            FAX - 214-975-5594<br>
            Main Line - 469-620-8516<br>
            <a href="https://fortresstaxandtrust.com" style="color:#4A6CF7;">
              fortresstaxandtrust.com
            </a>
          </p>

        </div>
      </div>
      `,
    };

    await sendMail(userEmailData);

    return res.json({
      status: "success",
      message:
        "Your message has been received. Our team will contact you soon.",
    });
  } catch (err) {
    console.error("Contact form error:", err);
    return res.status(500).json({
      status: "error",
      message: "Something went wrong while processing your request.",
      error: err.message || "Unknown error",
    });
  }
});

export default router;
