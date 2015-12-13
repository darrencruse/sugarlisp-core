console.log("Hello World!");
var square = function(n) {
  return (n * n);
};
console.log(square(10));

function myadd(x, y) {
  return (x + y);
}
if ((typeof(window) === "undefined")) {
  console.log("Not Running on browser")
} else {
  console.log("Running on browser")
};
console.log("1 and 2 are", ((1 !== 2) ?
  "not equal" :
  "equal"));
console.log("console is", ((Object.prototype.toString.call(console) === "[object Object]") ?
  "an object" :
  "not an object"));
console.log("console is", ((Object.prototype.toString.call(console) === "[object Array]") ?
  "an array" :
  "not an array"));
var arr = [
  1,
  2,
  3
];
console.log("for array:", arr);
console.log("first is:", arr[0]);
console.log("rest is:", arr.slice(1, arr.length));
var arrComma = [
  1,
  2,
  3
];
console.log("arr[2] is ", arrComma[2]);
var mtarr2 = [];
console.log("empty array is empty:", (0 === mtarr2.length));

(function(name, email, tel) {
  console.log(name);
  console.log(email);
})("John", "john@example.com", "555-555-5556");
console.log("code block first expr");
console.log("code block second expr");
var obj = {
  first: "fred",
  last: "flintstone",
  friends: [
    "barney",
    "betty"
  ],
  toString: function() {
    return [this.first, " ", this.last].join('');
  }
};
console.log(obj.toString());
var arr = [
  1,
  2,
  3,
  4
];
arr.forEach(function(el) {
  console.log(el);
});

function Ubertest(x) {
  this.x = x;

  function Test(x) {
    this.x = x;
    var arr = [
      1,
      2,
      3
    ];
    return arr.forEach(function(el) {
      console.log(this.x, el);
    }.bind(this));
  }
  var arr = [
    'a',
    'b',
    'c'
  ];
  return arr.forEach(function(el) {
    return new Test([this.x, " ", el].join(''));
  }.bind(this));
}
new Ubertest("Uber");
var todayDate = new Date();
console.log(new Date("October 13, 1975 11:13:00"));

var dayNum = todayDate.getDay();
console.log(dayNum);
var dayName;
switch (dayNum) {
  case 0:
    dayName = "sun";
    break;
  case 1:
    dayName = "mon";
    break;
  case 2:
    dayName = "tues";
    break;
  case 3:
    dayName = "wed";
    break;
  case 4:
    dayName = "thu";
    break;
  case 5:
    dayName("fri");
    break;
  default:
    dayName = "sat";
    break;
};
console.log(["switch says today is ", dayName].join(''));
var dayName = ((dayNum === 0) ?
  "sun" :
  ((dayNum === 1) ?
    "mon" :
    ((dayNum === 2) ?
      "tues" :
      ((dayNum === 3) ?
        "wed" :
        ((dayNum === 4) ?
          "thu" :
          ((dayNum === 5) ?
            "fri" :
            ((dayNum === 6) ?
              "sat" : undefined)))))));
console.log(["case says today is ", dayName].join(''));
var dayMsg = ((dayNum === 5) ?
  "tgif!!" :
  (((dayNum === 0) || (dayNum === 6)) ?
    "yahoo it's the weekend!" :
    (true ?
      "blech gotta work today it's a weekday" : undefined)));
console.log(["cond says about today: ", dayMsg].join(''));
console.log('a while loop (5 downto 1)');
var wx = 5;
while ((wx != 0)) {
  console.log(wx);
  wx--;
};
console.log("an each loop (1 to 3)");
console.log('a 4 "dotimes" loop (0 to 3)');
for (var tx = 0; tx < 4; tx++) {
  console.log(tx);
};

console.log("an each loop (1 to 3)");
[
  1,
  2,
  3
].forEach(function(elem, i, list) {
  console.log(elem);
});
console.log("a list comprehension of ['a','b','c'] with [3,4,5]");
console.log((function(___monad) {
  var mBind = ___monad.mBind,
    mResult = ___monad.mResult,
    mZero = ___monad.mZero,
    mPlus = ___monad.mPlus;
  var ____mResult = function(___arg) {
    return (((typeof(___arg) === "undefined") && (!(typeof(mZero) === "undefined"))) ?
      mZero :
      mResult(___arg));
  };
  return mBind([
    'a',
    'b',
    'c'
  ], function(letters) {
    return mBind([
      3,
      4,
      5
    ], function(numbers) {
      return (function() {
        return ____mResult([
          letters,
          numbers
        ]);
      })();
    });
  });
})({
  mBind: function(mv, mf) {
    return Array.prototype.map.call(mv, mf).reduce(function(accum, val) {
      return accum.concat(val);
    }, []);
  },
  mResult: function(v) {
    return [
      v
    ];
  },
  mZero: [],
  mPlus: function() {
    return Array.prototype.slice.call(arguments).reduce(function(accum, val) {
      return accum.concat(val);
    }, []);
  }
}));
var re = /[a-zA-Z0-9]/

console.log("fred flintstone contains 'flint':", /flint/.test("fred flintstone"))
console.log("fred flintstone contains 'flint':", /flint/.test("fred flintstone"))

if (/[^\.]+\.[^\.]+/.test("filename.ext")) {
  console.log("regex correctly says 'filename.ext' has an extension")
} else {
  console.log("regex incorrectly says 'filename.ext' has no extension")
}
console.log('hello');
var name = "fred";
var greeting = ['hello ', name].join('');
console.log(greeting);
(function() {
  try {
    console.log("In try");
    return (function() {
      throw "In catch";
    })();

  } catch (e) {
    return (function(err) {
      console.log(err);
    })(e);
  }
})();
console.log((10 * 10));
var i = 2;
console.log((++i * ++i));