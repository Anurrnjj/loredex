pipeline {
    agent any

    environment {
        ECR_REGISTRY = "928118644524.dkr.ecr.ap-south-1.amazonaws.com"
        IMAGE_NAME   = "loredex-repo"
        APP_SERVER   = "ubuntu@15.206.194.231"
        AWS_REGION   = "ap-south-1"
    }

    stages {
        stage('Checkout') {
            steps { checkout scm }
        }

        stage('Build image') {
            steps {
                withCredentials([
                    string(credentialsId: 'clerk-pub-key', variable: 'CLERK_KEY'),
                    string(credentialsId: 'app-url', variable: 'APP_URL')
                ]) {
                    sh """
                        docker build \
                          --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${CLERK_KEY} \
                          --build-arg NEXT_PUBLIC_APP_URL=${APP_URL} \
                          -t ${ECR_REGISTRY}/${IMAGE_NAME}:${env.BUILD_NUMBER} .
                    """
                }
                sh "docker tag ${ECR_REGISTRY}/${IMAGE_NAME}:${env.BUILD_NUMBER} ${ECR_REGISTRY}/${IMAGE_NAME}:latest"
            }
        }

        stage('Push to ECR') {
            steps {
                sh "aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}"
                sh "docker push ${ECR_REGISTRY}/${IMAGE_NAME}:${env.BUILD_NUMBER}"
                sh "docker push ${ECR_REGISTRY}/${IMAGE_NAME}:latest"
            }
        }

        stage('Deploy') {
            steps {
                sshagent(credentials: ['Loredex-ssh-key']) {
                    sh """
                        ssh -o StrictHostKeyChecking=no ${APP_SERVER} '
                          cd ~/loredex &&
                          sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${env.BUILD_NUMBER}/" .env &&
                          docker compose -f docker-compose.prod.yml --env-file .env pull &&
                          docker compose -f docker-compose.prod.yml --env-file .env up -d &&
                          docker compose -f docker-compose.prod.yml exec -T web node jobs/migrate.js
                        '
                    """
                }
            }
        }
    }
}
