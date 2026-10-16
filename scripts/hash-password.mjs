// Usage: npm run hash-password -- "your-strong-password"
// Prints a bcrypt hash for ADMIN_PASSWORD_HASH. The password itself is never stored.
import bcrypt from 'bcryptjs';

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Give a password of at least 12 characters: npm run hash-password -- "your-strong-password"');
  process.exit(1);
}
console.log(bcrypt.hashSync(password, 12));
