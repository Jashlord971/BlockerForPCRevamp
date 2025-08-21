const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔨 Building Eagle Blocker for PC...\n');

// Step 1: Build Vite project
console.log('📦 Building Vite project...');
execSync('vite build', { stdio: 'inherit' });

// Step 2: Ensure dist directory exists
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
}

// Step 3: Copy main.js
console.log('\n📋 Copying Electron files...');
fs.copyFileSync('src/main.js', 'dist/main.js');
console.log('✅ Copied main.js');

// Step 4: Copy all other JavaScript files from src
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

// Step 5: Copy HTML files
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

// Step 6: Copy CSS files if any
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

// Step 7: Copy data directory
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

// Step 8: Copy any additional asset files (images, icons, etc.)
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