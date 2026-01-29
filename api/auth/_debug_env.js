module.exports = async (req, res) => {
  const hasDatabaseUrl = !!process.env.DATABASE_URL;
  const hasPostgresUrl = !!process.env.POSTGRES_URL;
  const hasPostgresUrlNonPool = !!process.env.POSTGRES_URL_NON_POOLING;
  const hasPostgresPrisma = !!process.env.POSTGRES_PRISMA_URL;

  res.status(200).json({
    ok: true,
    env: {
      DATABASE_URL: hasDatabaseUrl,
      POSTGRES_URL: hasPostgresUrl,
      POSTGRES_URL_NON_POOLING: hasPostgresUrlNonPool,
      POSTGRES_PRISMA_URL: hasPostgresPrisma
    }
  });
};
