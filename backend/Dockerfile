FROM python:3.11-slim

WORKDIR /app

# ติดตั้ง nmap และ dependencies ระบบที่จำเป็นสำหรับการแสกนเน็ตเวิร์คและ Scapy
RUN apt-get update && apt-get install -y \
    nmap \
    libpcap-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# คัดลอกและติดตั้ง requirements ของ Python
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# คัดลอกโค้ดทั้งหมด
COPY . /app

EXPOSE 8000

# ใช้ 0.0.0.0 เพื่อให้สามารถเข้าถึง Backend จากภายนอก Container ได้
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]