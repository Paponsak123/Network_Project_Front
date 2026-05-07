# 🐸 Network Scanner 🐸

A network scanning web application with a FastAPI backend and Next.js frontend.

## Prerequisites

- Python 3.10+
- Node.js 18+
- MongoDB (or a MongoDB Atlas connection string)

## Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt
```

### Configure Environment Variables

Create a `.env` file in the `backend/` directory:

```
PORT=3000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_key
```

### Run Backend

```bash
cd backend
source venv/bin/activate
python app.py
```

The API will be available at `http://localhost:3000` with Swagger docs at `http://localhost:3000/api-docs`.

## Frontend Setup

```bash
cd frontend
npm install
```

### Run Frontend

```bash
npm run dev
```

The frontend will be available at `http://localhost:3002`.

## Deactivate Virtual Environment

When done working on the backend:

```bash
deactivate
```
