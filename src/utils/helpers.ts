import bcrypt from 'bcryptjs';

export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

export const comparePasswords = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

// // ✅ UPDATED: Now accepts optional count parameter
// export const generateBatchId = (type: 'BULK' | 'MULTI' | 'SINGLE' | 'QC_BULK' | 'QC_MULTI', count?: number): string => {
//   const timestamp = Date.now();
//   const random = Math.random().toString(36).substring(7).toUpperCase();
//   return `${type}_${timestamp}_${random}`;
// };

// ✅ UPDATED: Now accepts optional count parameter + PICKING types
export const generateBatchId = (type: 'BULK' | 'MULTI' | 'SINGLE' | 'QC_BULK' | 'QC_MULTI' | 'PICK_BULK' | 'PICK_MULTI', count?: number): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7).toUpperCase();
  return `${type}_${timestamp}_${random}`;
};
