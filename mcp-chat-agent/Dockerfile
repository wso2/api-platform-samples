# Use Python 3.11 as base image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire project
COPY . .

# Install mcp-use package from GitHub
RUN pip install git+https://github.com/wso2/bijira-samples.git#subdirectory=external-lib/mcp-use

# Expose port 5050
EXPOSE 5050

CMD ["python", "app.py"]
