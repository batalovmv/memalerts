# deploy-dev

#Не совершать других действий, строго и кратко
cd "C:\Users\LOTAS\Desktop\Memalerts\memalerts-backend"; git add -A
записать коммит об изменениях краткий
cd "C:\Users\LOTAS\Desktop\Memalerts\memalerts-backend"; git push origin main

# push в main триггерит self-hosted deploy на VPS (beta, /opt/memalerts-backend-beta, порт 3002)