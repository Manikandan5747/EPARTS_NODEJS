# FROM mcr.microsoft.com/windows/servercore:ltsc2019

# # Download and install Node.js manually
# # Install Node.js (manually, because no package manager)
# # RUN powershell -Command `Invoke-WebRequest https://nodejs.org/dist/v14.21.3/node-v14.21.3-x64.msi -OutFile nodejs.msi ; `Start-Process msiexec.exe -Wait -ArgumentList '/quiet', '/qn', '/i', 'nodejs.msi'; `Remove-Item -Force nodejs.msi
# RUN powershell -Command `Invoke-WebRequest https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi -OutFile nodejs.msi ; `Start-Process msiexec.exe -Wait -ArgumentList '/quiet', '/qn', '/i', 'nodejs.msi'; `Remove-Item -Force nodejs.msi

# WORKDIR /src

# # Copy only api-gateway files
# ADD package.json package-lock.json ./
# RUN npm install
# COPY api-gateway/. .

# # Copy shared libs folder
# COPY libs ./libs

# CMD ["node", "index.js"]



FROM node:alpine

WORKDIR /src
ADD package.json package-lock.json ./
RUN npm install

ADD . .
