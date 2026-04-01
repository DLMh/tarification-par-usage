const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const digits = "0123456789";
const charset = letters + digits;

export function generatePassword(length: number = 8): string {
  const len = Math.max(6, Math.min(length, 10));
  let pwd = "";
  for (let i = 0; i < len; i++) {
    const idx = Math.floor(Math.random() * charset.length);
    pwd += charset[idx];
  }
  return pwd;
}

