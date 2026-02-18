import fs from "fs";
import readline from "readline";
import { google } from "googleapis";

const path = process.env.HOME + "/Downloads/client_secret_99774649511-520lgng8cf2s8vcva2gp99qdji76fdie.apps.googleusercontent.com.json";

const creds = JSON.parse(fs.readFileSync(path, "utf8"));

const { client_id, client_secret, redirect_uris } = creds.installed;

const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

const url = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive.file"],
});

console.log("\nABRE ESTE LINK EN TU NAVEGADOR:\n");
console.log(url);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("\nPEGA EL CODIGO AQUI: ", async (code) => {
  const { tokens } = await oAuth2Client.getToken(code.trim());
  console.log("\nREFRESH_TOKEN:\n");
  console.log(tokens.refresh_token);
  process.exit(0);
});

