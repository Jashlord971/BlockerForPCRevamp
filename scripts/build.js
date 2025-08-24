const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔨 Building Eagle Blocker for PC...\n');

console.log('📦 Building Vite project...');
execSync('vite build', { stdio: 'inherit' });

if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
}

console.log('\n📋 Copying Electron files...');
fs.copyFileSync('src/main.js', 'dist/main.js');
console.log('✅ Copied main.js');

const jsFiles = fs.readdirSync('src').filter(file =>
    file.endsWith('.js') && file !== 'main.js'
);

jsFiles.forEach(file => {
    const srcPath = path.join('src', file);
    const distPath = path.join('dist', file);

    try {
        fs.copyFileSync(srcPath, distPath);
        console.log(`✅ Copied ${file}`);
    } catch (err) {
        console.warn(`⚠️  Warning: Could not copy ${file}`);
    }
});

console.log('\n🌐 Copying HTML files...');
const htmlFiles = fs.readdirSync('src').filter(file => file.endsWith('.html'));

htmlFiles.forEach(file => {
    const srcPath = path.join('src', file);
    const distPath = path.join('dist', file);

    try {
        fs.copyFileSync(srcPath, distPath);
        console.log(`✅ Copied ${file}`);
    } catch (err) {
        console.warn(`⚠️  Warning: Could not copy ${file}`);
    }
});

console.log('\n🎨 Copying CSS files...');
const cssFiles = fs.readdirSync('src').filter(file => file.endsWith('.css'));

cssFiles.forEach(file => {
    const srcPath = path.join('src', file);
    const distPath = path.join('dist', file);

    try {
        fs.copyFileSync(srcPath, distPath);
        console.log(`✅ Copied ${file}`);
    } catch (err) {
        console.warn(`⚠️  Warning: Could not copy ${file}`);
    }
});

if (fs.existsSync('data')) {
    console.log('\n📊 Copying data directory...');
    if (!fs.existsSync('dist/data')) {
        fs.mkdirSync('dist/data', { recursive: true });
    }

    const dataFiles = fs.readdirSync('data');
    dataFiles.forEach(file => {
        try {
            fs.copyFileSync(path.join('data', file), path.join('dist/data', file));
            console.log(`✅ Copied data/${file}`);
        } catch (err) {
            console.warn(`⚠️  Warning: Could not copy data/${file}`);
        }
    });
}

console.log('\n🖼️  Copying asset files...');
const assetExtensions = ['.png', '.jpg', '.jpeg', '.ico', '.svg', '.gif'];
const assetFiles = fs.readdirSync('src').filter(file =>
    assetExtensions.some(ext => file.toLowerCase().endsWith(ext))
);

assetFiles.forEach(file => {
    const srcPath = path.join('src', file);
    const distPath = path.join('dist', file);

    try {
        fs.copyFileSync(srcPath, distPath);
        console.log(`✅ Copied ${file}`);
    } catch (err) {
        console.warn(`⚠️  Warning: Could not copy ${file}`);
    }
});

console.log('\n🎉 Build completed successfully!');
console.log('📁 All files have been copied to the dist/ directory.');
console.log('🚀 Ready for electron-builder packaging!');