module.exports = async (req, res) => {
  res.status(200).json({
    ok: true,
    now: new Date().toISOString(),
    sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    ref: process.env.VERCEL_GIT_COMMIT_REF || null,
    env: process.env.VERCEL_ENV || null
  });
};
