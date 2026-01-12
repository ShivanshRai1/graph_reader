# Graph Data Capture - Backend API

A FastAPI-based REST API for managing graph data capture with MySQL database.

## Features

- Create, read, update, delete curves
- Manage data points for each curve
- Full CRUD operations with validation
- CORS enabled for frontend integration
- Comprehensive error handling

## Prerequisites

- Python 3.8+
- MySQL Server running locally or remote
- Virtual environment setup

## Installation & Setup

### 1. Activate Virtual Environment
```bash
# Windows
venv\Scripts\activate

# Mac/Linux
source venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure Database
Create a MySQL database:
```sql
CREATE DATABASE graph_capture;
```

Update `.env` file with your MySQL credentials:
```
DATABASE_URL=mysql+pymysql://username:password@localhost/graph_capture
```

### 4. Run the Server
```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`

## API Documentation

Once running, visit:
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

## API Endpoints

### Curves
- `POST /api/curves` - Create a new curve with data points
- `GET /api/curves` - List all curves (with pagination)
- `GET /api/curves/{curve_id}` - Get specific curve
- `PUT /api/curves/{curve_id}` - Update curve metadata
- `DELETE /api/curves/{curve_id}` - Delete curve and all data points

### Data Points
- `POST /api/curves/{curve_id}/points` - Add a data point
- `GET /api/curves/{curve_id}/points` - Get all points for a curve
- `DELETE /api/points/{point_id}` - Delete specific data point

### Health Check
- `GET /` - API status
- `GET /health` - Health check

## Example Request

```bash
curl -X POST "http://localhost:8000/api/curves" \
  -H "Content-Type: application/json" \
  -d '{
    "curve_name": "FM260A [RECTONSEMI]",
    "x_scale": "Linear",
    "y_scale": "Linear",
    "x_unit": "V",
    "y_unit": "pF",
    "x_min": 0,
    "x_max": 100,
    "y_min": 0,
    "y_max": 700,
    "temperature": "25°C",
    "data_points": [
      {"x_value": 0, "y_value": 650},
      {"x_value": 10, "y_value": 200},
      {"x_value": 50, "y_value": 50}
    ]
  }'
```

## Database Schema

### Curves Table
- id (Primary Key)
- curve_name
- x_scale, y_scale
- x_unit, y_unit
- x_min, x_max, y_min, y_max
- temperature
- created_at, updated_at

### Data Points Table
- id (Primary Key)
- curve_id (Foreign Key)
- x_value, y_value
- created_at

## Deployment to Render.com

1. Push code to GitHub
2. Connect repository to Render
3. Set environment variables in Render dashboard
4. Deploy

## Environment Variables

```
DATABASE_URL=mysql+pymysql://user:pass@host/dbname
DEBUG=False
ENVIRONMENT=production
FRONTEND_URL=https://yourdomain.com
```

## Testing

Use Swagger UI at `/docs` to test all endpoints or use curl commands.

## Troubleshooting

**Database Connection Error:**
- Verify MySQL is running
- Check DATABASE_URL in .env
- Ensure database exists

**CORS Error:**
- Update `allow_origins` in main.py with your frontend URL
- For local dev, `http://localhost:5173` should work

## Future Enhancements

- Authentication/Authorization
- Image storage for captured graphs
- Advanced data analysis endpoints
- Data export (CSV, PDF)
- Batch import/export
