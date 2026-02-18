export default function handler(req, res) {
  const has = (k) => !!process.env[k] && String(process.env[k]).length > 10;
  return res.json({
    ok: true,
    GOOGLE_OAUTH_CLIENT_ID: has("GOOGLE_OAUTH_CLIENT_ID"),
    GOOGLE_OAUTH_CLIENT_SECRET: has("GOOGLE_OAUTH_CLIENT_SECRET"),
    GOOGLE_OAUTH_REFRESH_TOKEN: has("GOOGLE_OAUTH_REFRESH_TOKEN"),
    DRIVE_FOLDER_ID: has("DRIVE_FOLDER_ID"),
  });
}
