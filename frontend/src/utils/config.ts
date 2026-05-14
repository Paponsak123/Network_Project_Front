/**
 * คืนค่า URL พื้นฐานสำหรับเรียก API
 */
export const getApiUrl = (): string => {
  // ดึงค่าจาก Environment Variable ที่เราฝังไว้ผ่าน start.sh
  // สำคัญ: ต้องเป็น NEXT_PUBLIC_ เพื่อให้ฝั่ง Browser (มือถือ) มองเห็นค่านี้
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  
  // กรณีรัน Development ปกติในคอมพิวเตอร์ (ใช้ empty string เพื่อให้ rewrite ทำงาน)
  return ""; 
};