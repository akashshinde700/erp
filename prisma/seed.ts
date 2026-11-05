/** CLI: bun run prisma/seed.ts [--force] */
import { seedDatabase } from '../src/lib/seed'

const force = process.argv.includes('--force')
seedDatabase(force)
  .then((r) => {
    console.log(JSON.stringify(r, null, 2))
    process.exit(0)
  })
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
