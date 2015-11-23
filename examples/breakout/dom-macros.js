((export $ 
    (macro 
      (id) 
      (
        (. document getElementById) 
        (~ id)))) 
  (export $listener 
    (macro 
      (domObj eventName ...rest) 
      (
        (. 
          (~ domObj) addEventListener) 
        (~ eventName) 
        (=> 
          (event) 
          (~ rest))))))
