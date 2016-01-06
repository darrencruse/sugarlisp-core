// which dialects should be automatically "#used"
// in a file with the given extension?
//
// note: the order is the same as #uses in an actual
//  file (i.e. later ones override the earlier ones)
module.exports = {
  // "code" formats

  score: ['core'],
  slisp: ['plus'],
  sugar: ['sugarscript'],

  // "data" formats

  // these for people who like lispy syntax:
  slon: ['plus'],
  slml: ['plus', 'html'],
  slss: ['plus', 'css'],
  
  // and these for people who like the sugarscript syntax:
  sson: ['sugarscript'],
  ssml: ['sugarscript', 'html'],
  ssss: ['sugarscript', 'css']
};
