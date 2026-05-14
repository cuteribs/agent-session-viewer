cd packages/server
npm install && npm run build
mkdir dist/public

cd ../client
npm install && npm run build
cp -r dist/. ../server/dist/public/

cd ..
node server/dist/index.js