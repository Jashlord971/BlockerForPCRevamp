const { exec } = require('child_process');

async function runDebugTests() {
    const reader = new AllWindowsTextReader();

    console.log('=== Debug Test Suite ===\n');

    // Test 1: Basic PowerShell functionality
    console.log('1. Testing basic PowerShell...');
    const psWorking = await reader.testPowerShell();
    console.log(`PowerShell working: ${psWorking}\n`);

    // Test 2: Basic window info (fallback method)
    console.log('2. Testing basic window info...');
    try {
        const basicWindows = await reader.getBasicWindowInfo();
        console.log(`Basic windows found: ${basicWindows.length}`);
        if (basicWindows.length > 0) {
            console.log('First window:', JSON.stringify(basicWindows[0], null, 2));
        }
    } catch (error) {
        console.error('Basic window info failed:', error.message);
    }
    console.log('');

    // Test 3: Full method
    console.log('3. Testing full getAllWindowsText...');
    try {
        const allWindows = await reader.getAllWindowsText();
        console.log(`Full windows found: ${allWindows.length}`);
        if (allWindows.length > 0) {
            console.log('First window:', JSON.stringify(allWindows[0], null, 2));
        }
    } catch (error) {
        console.error('Full method failed:', error.message);
    }
    console.log('');

    // Test 4: Get all text strings (the method that was failing)
    console.log('4. Testing getAllTextStrings...');
    try {
        const allTexts = await reader.getAllTextStrings();
        console.log(`Text strings found: ${allTexts.length}`);
        if (allTexts.length > 0) {
            console.log('First 5 texts:');
            allTexts.slice(0, 5).forEach((text, i) => {
                console.log(`  ${i + 1}. ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
            });
        }
    } catch (error) {
        console.error('getAllTextStrings failed:', error.message);
    }
    console.log('');

    // Test 5: Search functionality
    console.log('5. Testing search functionality...');
    try {
        const searchResults = await reader.searchAllWindows('Windows');
        console.log(`Search results for "Windows": ${searchResults.length}`);
    } catch (error) {
        console.error('Search failed:', error.message);
    }

    console.log('\n=== Debug Complete ===');
}

// Also create a simple version that just gets process windows
async function simpleWindowTest() {
    const { exec } = require('child_process');

    console.log('\n=== Simple Window Test ===');

    const command = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json"`;

    exec(command, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        console.log('=== RAW POWERSHELL OUTPUT ===');
        console.log('Error:', error ? error.message : 'None');
        console.log('STDERR:', stderr || 'None');
        console.log('STDOUT length:', stdout ? stdout.length : 0);
        console.log('STDOUT content:');
        console.log(stdout || 'EMPTY');
        console.log('=== END RAW OUTPUT ===');

        if (stdout) {
            try {
                const parsed = JSON.parse(stdout);
                console.log('\nParsed successfully:');
                const results = Array.isArray(parsed) ? parsed : [parsed];
                console.log(`Found ${results.length} windows`);
                results.slice(0, 3).forEach(window => {
                    console.log(`- ${window.ProcessName}: ${window.MainWindowTitle}`);
                });
            } catch (parseError) {
                console.error('Parse failed:', parseError.message);
            }
        }
    });
}

// Run both tests
runDebugTests().then(() => {
    setTimeout(simpleWindowTest, 2000);
});

module.exports = { runDebugTests, simpleWindowTest };