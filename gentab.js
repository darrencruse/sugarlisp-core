var utils = require('./utils');

// to compile broken macros or other keywords written in lispy,
// remove them below, do the compile, then add them back in.
module.exports = utils.merge(
            require('./gentab-boot-native'),
            require('./gentab-native'),
            require('./gentab-sugar'),
            require('./macros.js'));
