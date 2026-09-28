const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');

const config = {
  watchFolders: [path.join(root, 'engine/src'), path.join(root, 'content/dist')],
  resolver: {
    extraNodeModules: {
      '@dsims/engine': path.join(root, 'engine/src'),
      '@dsims/content': path.join(root, 'content/dist'),
    },
    nodeModulesPaths: [path.join(__dirname, 'node_modules')],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
