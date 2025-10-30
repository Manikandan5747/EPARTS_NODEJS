pipeline {
    agent any

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build & Run with Docker Compose') {
            steps {
                script {
                    bat """
                        echo ===============================
                        echo 🔧 Docker Compose Build Started
                        echo ===============================

                        cd ${WORKSPACE}
                        docker-compose down
                        docker-compose build
                        docker-compose up -d
                        docker ps

                        echo ===============================
                        echo ✅ Build & Run Completed
                        echo ===============================
                    """
                }
            }
        }
    }

    post {
        always {
            echo 'Pipeline execution finished.'
        }
        failure {
            echo '❌ Build or container startup failed!'
        }
        success {
            echo '✅ All services running successfully!'
        }
    }
}
