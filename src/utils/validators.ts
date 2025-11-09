export const validateEmail = (email: string): boolean => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

export const validateUsername = (username: string): boolean => {
  return username.length >= 3 && username.length <= 50;
};

export const validatePassword = (password: string): boolean => {
  return password.length >= 6;
};

export const validateWarehouseCode = (code: string): boolean => {
  return code.length >= 2 && code.length <= 10;
};

export const validateWSN = (wsn: string): boolean => {
  return wsn.length > 0 && wsn.length <= 255;
};
