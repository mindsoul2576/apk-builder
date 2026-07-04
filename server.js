const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const APK_DIR = path.join(__dirname, 'apks');
fs.ensureDirSync(APK_DIR);

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'APK Builder is running!' });
});

app.post('/generate', async (req, res) => {
    try {
        const { url, name, packageId } = req.body;
        
        if (!url || !name) {
            return res.status(400).json({ error: 'URL and name required' });
        }

        console.log(`📱 Building APK for: ${name} (${url})`);

        // 1. Create Capacitor project
        const projectDir = path.join(__dirname, 'temp', Date.now().toString());
        await fs.ensureDir(projectDir);

        // 2. Create capacitor.config.json
        const config = {
            appId: packageId || `com.${name.toLowerCase().replace(/\s/g, '')}`,
            appName: name,
            webDir: 'www',
            server: {
                url: url,
                androidScheme: 'https'
            }
        };
        await fs.writeJson(path.join(projectDir, 'capacitor.config.json'), config, { spaces: 2 });

        // 3. Create www/index.html (minimal)
        const wwwDir = path.join(projectDir, 'www');
        await fs.ensureDir(wwwDir);
        await fs.writeFile(path.join(wwwDir, 'index.html'), `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name}</title>
    <meta http-equiv="refresh" content="0; url=${url}">
</head>
<body>
    <p>Loading ${name}...</p>
</body>
</html>
`);

        // 4. Initialize Capacitor
        await execPromise('npx cap init', { cwd: projectDir });
        
        // 5. Add Android
        await execPromise('npx cap add android', { cwd: projectDir });
        
        // 6. Sync
        await execPromise('npx cap sync', { cwd: projectDir });
        
        // 7. Build APK
        await execPromise('npx cap open android', { cwd: projectDir });

        // Wait for build to complete
        await new Promise(resolve => setTimeout(resolve, 30000));

        // 8. Find APK
        const apkPath = path.join(projectDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
        
        if (await fs.pathExists(apkPath)) {
            const destPath = path.join(APK_DIR, `${name.toLowerCase().replace(/\s/g, '-')}.apk`);
            await fs.copy(apkPath, destPath);
            
            // Cleanup
            await fs.remove(projectDir);
            
            return res.json({
                success: true,
                downloadUrl: `/download/${path.basename(destPath)}`,
                message: 'APK generated successfully!'
            });
        } else {
            throw new Error('APK not found after build');
        }

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/download/:filename', (req, res) => {
    const filepath = path.join(APK_DIR, req.params.filename);
    if (fs.existsSync(filepath)) {
        res.download(filepath);
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

function execPromise(cmd, options) {
    return new Promise((resolve, reject) => {
        exec(cmd, options, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve({ stdout, stderr });
        });
    });
}

app.listen(PORT, () => {
    console.log(`🚀 APK Builder running on port ${PORT}`);
});
