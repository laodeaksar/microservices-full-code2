import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    type: "OAuth2",
    user: "akhsarodhe@gmail.com",
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  },
});

const sendMail = async ({
  email,
  subject,
  text,
  html
}: {
  email: string;
  subject: string;
  text: string;
  html?: string
}) => {
  const res = await transporter.sendMail({
    from: '"Aksar La\'ode" <akhsarodhe@gmail.com>',
    to: email,
    subject,
    text,
    html
  });

  console.log("MESSAGE SENT:", res);
};

export default sendMail;
