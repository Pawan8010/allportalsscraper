require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@ritindia.edu';
  const password = '8010';
  const passwordHash = await bcrypt.hash(password, 12);
  
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'admin' },
    create: { email, passwordHash, role: 'admin' },
  });
  
  console.log(`Admin user created/updated: ${user.email} (password: ${password})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
