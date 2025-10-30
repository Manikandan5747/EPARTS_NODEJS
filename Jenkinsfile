pipeline {
    agent any

// tools {
//     docker 'DockerPipeline'
//     nodejs 'NodeJS'
// }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Check Docker Environment') {
            steps {
                bat """
                    echo ================================
                    echo 🔍 Checking Docker Installation
                    echo ================================

                    docker --version
                    docker compose version

                    echo ================================
                    echo ✅ Docker Environment Verified
                    echo ================================
                """
            }
        }

        stage('Install Dependencies') {
            steps {
                bat """
                    echo ================================
                    echo 📦 Installing NPM Dependencies
                    echo ================================
                    cd ${WORKSPACE}
                    npm install
                """
            }
        }

        stage('Docker Compose Build & Run') {
            steps {
                bat """
                    echo ================================
                    echo 🐳 Building & Starting Containers
                    echo ================================
                    cd ${WORKSPACE}
                    docker compose down
                    docker compose build
                    docker compose up -d
                    docker ps
                    echo ================================
                    echo ✅ Docker Compose Completed
                    echo ================================
                """
            }
        }
    }

    post {
        success {
            echo '✅ All services are up and running successfully!'
        }
        failure {
            echo '❌ Build failed! Please check the logs for details.'
        }
        always {
            echo 'Pipeline execution finished.'
        }
    }
}
