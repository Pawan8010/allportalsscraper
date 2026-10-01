const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  try {
    const dbs = await prisma.$queryRawUnsafe('SELECT datname, pg_size_pretty(pg_database_size(datname)) as size, pg_database_size(datname) as raw_size FROM pg_database WHERE datistemplate = false ORDER BY raw_size DESC;');
    console.log(dbs.map(d => `${d.datname}: ${d.size}`).join('\n'));
  } catch(e) { console.error(e) }
}
main().finally(() => prisma.$disconnect());
