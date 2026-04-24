type OtpRecord = {
  code: string;
  expiresAt: number;
};

const otpStore = new Map<string, OtpRecord>();

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone.startsWith("+") ? phone : `+${digits}`;
}

export function sendOtp(phoneRaw: string) {
  const phone = normalizePhone(phoneRaw);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 5 * 60 * 1000;

  otpStore.set(phone, { code, expiresAt });

  console.log(`[Road Share OTP] phone=${phone} code=${code} (expires in 5m)`);

  return { phone, code };
}

export function verifyOtp(phoneRaw: string, code: string) {
  const phone = normalizePhone(phoneRaw);
  const record = otpStore.get(phone);

  if (!record) return { ok: false as const, reason: "no_code" as const };
  if (Date.now() > record.expiresAt) {
    otpStore.delete(phone);
    return { ok: false as const, reason: "expired" as const };
  }
  if (record.code !== code) return { ok: false as const, reason: "invalid" as const };

  otpStore.delete(phone);
  return { ok: true as const, phone };
}