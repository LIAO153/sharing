const express = require('express');
const fileUpload = require('express-fileupload');
const basicAuth = require('express-basic-auth');
const handler = require('serve-handler');
const fs = require('fs');
const _path = require("path");
const crypto = require('crypto');
const config = require('./config');
const utils = require('./utils');

/**
 * Express中提供assets资源
 * @type {string}
 */
const assetsPath = _path.join(__dirname, '../assets');
app.use('/assets', express.static(assetsPath));

/**
 * 优化
 * @param path
 * @param files
 * @returns {Promise<void>}
 */
const mvFiles = async (path, files) => {
    const selectedFiles = Array.isArray(files) ? files : [files];

    const mvTask = selectedFiles.map(async (selectedFile) => {
        const selectedFileName = Buffer.from(selectedFile.name, 'ascii').toString('utf8');
        const uploadPath = _path.join(__dirname, path, selectedFileName);
        utils.debugLog(`upload path: ${uploadPath}`);
        try {
            await selectedFile.mv(uploadPath);
            return {status: 'fulfilled', value: {uploadPath}};
        } catch (err) {
            return {status: 'rejected', reason: {uploadPath, err}};
        }
    });
}

/**
 * 优化
 */
const setupBasicAuth = (app) => {
    if (config.auth.username && config.auth.password) {
        app.use(basicAuth({
            challenge: true,
            realm: 'sharing',
            users: { [config.auth.username]: config.auth.password }
        }));
    }
};

const getHashedRoute = (pathItem) => {
    return `/folder/${crypto.createHash('md5').update(pathItem).digest('hex')}`;
};

const setupReceiveRoute = (app, path, postUploadRedirectUrl, shareAddress) => {
    app.use(fileUpload());
    app.get('/receive', (req, res) => {
        const form = fs.readFileSync(`${__dirname}/receive-form.html`);
        res.send(form.toString().replace(/\{shareAddress\}/, shareAddress));
    });

    app.post('/upload', async (req, res) => {
        if (!req.files || Object.keys(req.files).length === 0) {
            res.status(400).send('No files were received.');
            return;
        }

        const { fulfilledList, rejectedList } = await mvFiles(path[0], req.files.selected);
        const messages = {
            success: fulfilledList.map(({ value: { uploadPath } }) => uploadPath).join(',\n'),
            error: rejectedList.map(({ reason: { uploadPath } }) => uploadPath).join(',\n')
        };

        const feedback = `
            ${messages.success ? `Shared at \n ${messages.success}` : ""}
            ${messages.error ? `Sharing failed: \n ${messages.error}` : ""}
        `;

        res.send(`
            <script>
                window.alert('${feedback.trim()}');
                window.location.href = '${postUploadRedirectUrl}';
            </script>
        `);
    });
};

const setupShareRoute = (app, path) => {
    app.use('/share', (req, res) => {
        const form = fs.readFileSync(`${__dirname}/index.html`);
        const pathList = path.map((pathItem) => {
            const isFile = fs.lstatSync(pathItem).isFile();
            const baseName = _path.basename(pathItem);
            const type = isFile ? _path.extname(pathItem).replace('.', '') : "folder";
            const route = getHashedRoute(isFile ? _path.dirname(pathItem) : pathItem);
            return { name: `${baseName}/`, url: `${route}/${isFile ? baseName : ''}`, type };
        });
        res.send(form.toString().replace(/\"\{pathList\}\"/, JSON.stringify(pathList)));
    });
};

const setupFolderPathRoute = (app, path, clipboard, updateClipboardData) => {
    const dirPathList = Array.from(new Set(path.map(item => fs.lstatSync(item).isFile() ? _path.dirname(item) : item)));
    dirPathList.forEach((pathItem) => {
        const route = getHashedRoute(pathItem);
        app.use(route, (req, res) => {
            if (clipboard) {
                updateClipboardData();
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            }
            if (req.path !== '/') {
                console.log({
                    success: true,
                    type: 'DOWNLOAD',
                    data: { name: _path.basename(req.path), path: req.path },
                    msg: `Download: ${req.path}`
                });
            }
            handler(req, res, { public: pathItem, etag: true, prefix: route });
        });
    });
};

const start = ({ port, path, receive, clipboard, updateClipboardData, onStart, postUploadRedirectUrl, shareAddress }) => {
    const app = express();

    setupBasicAuth(app);

    app.get('/', (req, res) => {
        const routes = {
            receive: '/receive',
            clipboard: getHashedRoute(_path.dirname(path[0])) + '/.clipboard-tmp',
            default: `/share?time=${new Date().getTime()}`
        };
        const targetRoute = receive ? routes.receive : (clipboard ? routes.clipboard : routes.default);
        res.redirect(targetRoute);
    });

    if (receive) {
        setupReceiveRoute(app, path, postUploadRedirectUrl, shareAddress);
    }

    setupShareRoute(app, path);
    setupFolderPathRoute(app, path, clipboard, updateClipboardData);

    config.ssl.protocolModule.createServer(config.ssl.option, app).listen(port, onStart);
};

module.exports = start;

