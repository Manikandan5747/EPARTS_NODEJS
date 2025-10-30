# Use a Windows Server Core base image compatible with Windows Server 2019
FROM mcr.microsoft.com/windows/servercore:ltsc2019

# Set the working directory
WORKDIR /app
VOLUME C:\\src

# Install Node.js (manually, because no package manager)
RUN powershell -Command `Invoke-WebRequest https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi -OutFile nodejs.msi ; `Start-Process msiexec.exe -Wait -ArgumentList '/quiet', '/qn', '/i', 'nodejs.msi'; `Remove-Item -Force nodejs.msi

# Copy your Node.js microservice files into the container
COPY . .

# Install dependencies
RUN node -v && npm -v && npm install

# Expose the port your app runs on
EXPOSE 3000

# Start the Node.js microservice
CMD ["node", "src/index.js"]

