var utils = require('./utils');

// to compile broken macros or other keywords written in lispy,
// remove them below, do the compile, then add them back in.
module.exports = utils.merge(
            require('./keywords-boot-native'),
            require('./keywords-native'),
            require('./keywords-sugar'),
            require('./macros.js'));
