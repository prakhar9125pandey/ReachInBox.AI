const axios = require("axios");
const express = require("express");
require("dotenv").config();
const { createConfig } = require("../helpers/utils");
const { OAuth2Client } = require("google-auth-library");
const { connection } = require("../middlewares/redis.middleware");
const googleRouter = express.Router();
const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_SECRECT_KEY });

// google oauth
const oAuth2Client = new OAuth2Client({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI,
});

const scopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
];

googleRouter.get("/auth/google", (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
  });
  res.redirect(authUrl);
});

let accessToken;
googleRouter.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("Authorization code missing.");
  }

  try {
    const { tokens } = await oAuth2Client.getToken(code);

    const { access_token, refresh_token, scope } = tokens;

    accessToken = access_token;

    if (scope.includes(scopes.join(" "))) {
      res.send("Restricted scopes test passed.");
    } else {
      res.send("Restricted scopes test failed: Scopes are not restricted.");
    }
  } catch (error) {
    console.error("Error exchanging authorization code:", error.message);
    res.status(500).send("Error exchanging authorization code.");
  }
});

// git user profile details
const getUser = async (req, res) => {
  try {
    const url = `https://gmail.googleapis.com/gmail/v1/users/${req.params.email}/profile`;

    const token = accessToken;
    connection.setex(req.params.email, 3600, token);

    if (!token) {
      return res.send("Token not found , Please login again to get token");
    }

    const config = createConfig(url, token);

    const response = await axios(config);

    res.json(response.data);
  } catch (error) {
    console.log("Can't get user email data ", error.message);
    res.send(error.message);
  }
};


const sendMail = async (data, token) => {
  try {
    if (!token) {
      throw new Error("Token not found, please login again to get token");
    }

    const emailContent = `dont use any name instead use dear user.here you have to create advertisement mail, your reply should provide an enticing advertisement for our ReachInbox platform. Highlight the key features and benefits to capture their interest and encourage them to learn more. Here's a suggested prompt:\n\n'Hello!\n\nWe're thrilled to introduce you to ReachInbox – the ultimate email management platform designed to streamline your communication workflows and boost your productivity.\n\nDiscover how ReachInbox can transform your email experience:\n\n- **Secure Mailing:** Rest assured that your emails are protected with state-of-the-art encryption, keeping your communication private and secure.\n\n- **Automated Emails:** Say goodbye to manual tasks! With ReachInbox, you can automate your email workflows, schedule emails, and set triggers to send messages at the perfect time.\n\n- **Customizable Templates:** Personalize your emails effortlessly! Create stunning templates tailored to your brand and audience, saving you time and effort.\n\nReady to supercharge your email productivity? Reply to this email to learn more about ReachInbox and take your communication to the next level.\n\nDon't miss out on this opportunity to revolutionize your inbox with ReachInbox. Get started today! . give this form of containers heading, features and benefits`;

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-0301",
      max_tokens: 350,
      temperature: 0.5,
      messages: [
        {
          role: "user",
          content: emailContent,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    console.log(content)

    const mailOptions = {
      from: data.from,
      to: data.to,
      subject: `${data.label} of ReachInBox`,
      text: `${data.label} of ReachInBox`,
      html: `
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 10px; text-align: center; font-family: Arial, sans-serif;">
          <h2 style="color: #333;">Exciting Offer from Reach-In Box!</h2>
          <p style="font-size: 16px; color: #666;">Dear valued customer,</p>
          <p style="font-size: 16px; color: #666;">${content}</p>
          <p style="font-size: 16px; color: #666;">Best regards,</p>
          <p style="font-size: 16px; color: #666;"><strong>Shraddha Gawde</strong><br>Reach-In Box</p>
        </div>`
    };

    const emailData = {
      raw: Buffer.from(
        [
          'Content-type: text/html;charset=iso-8859-1',
          'MIME-Version: 1.0',
          `from: ${data.from}`,
          `to: ${data.to}`,
          `subject: ${mailOptions.subject}`,
          `text: ${mailOptions.text}`,
          `html: ${mailOptions.html}`,
          
          
        ].join('\n')
      ).toString('base64')
    };

    const sendMessageResponse = await axios.post(`https://gmail.googleapis.com/gmail/v1/users/${data.from}/messages/send`, emailData, {
      headers: {
        "Content-Type": "application/json",
        'Authorization': `Bearer ${token}`
      }
    });

    // Modify label for the sent email
    const labelUrl = `https://gmail.googleapis.com/gmail/v1/users/${data.from}/messages/${sendMessageResponse.data.id}/modify`;
    const labelConfig = {
      method: 'POST',
      url: labelUrl,
      headers: {
        'Authorization': `Bearer ${token}`
      },
      data: {
        addLabelIds: ["Label_4"]
      }
    };
    await axios(labelConfig);

    return sendMessageResponse.data.id;
  } catch (error) {
    console.error("Error sending email:", error);
    throw new Error("Can't send email: " + error.message);
  }
};



module.exports = {
  googleRouter,
  sendMail,
  getUser,
};
