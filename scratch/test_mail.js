import nodemailer from "nodemailer";
import 'dotenv/config';

console.log("Testing email connection with:");
console.log("MASTER_EMAIL:", process.env.MASTER_EMAIL);
console.log("MASTER_PASS:", process.env.MASTER_PASS ? "****" : "undefined");

const transporter = nodemailer.createTransport({
  host: "mail.blueinge.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.MASTER_EMAIL,
    pass: process.env.MASTER_PASS,
  },
  tls: {
    rejectUnauthorized: false
  }
});

async function main() {
  try {
    console.log("Verifying transporter...");
    await transporter.verify();
    console.log("Transporter is ready to send emails!");
  } catch (error) {
    console.error("Verification failed:", error);
  }
}

main();
