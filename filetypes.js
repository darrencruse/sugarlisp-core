// which dialects should be automatically "used"
// in a file with the given extension?
//
// note: the order is the same as #uses in an actual
//  file (i.e. later ones override the earlier ones)
module.exports = {
  // "code" formats
  slisp: ['core'],
  ls: ['core'],
  sugar: ['core', 'sugarscript'],

  // "data" formats
  slson: ['core'],
  slml: ['core', 'html'],
  slss: ['core', 'css']
};
