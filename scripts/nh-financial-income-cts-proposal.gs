    // NH official SDK: cts_flag and response code determine whether a nonempty
    // continuation key actually requests another page. Never export the key.
    function coverageContinuation(headers,body,code){
      function header(name){
        var values=[];
        Object.keys(headers||{}).forEach(function(k){
          if(k.toLowerCase()!==name)return;
          var raw=headers[k],arr=Array.isArray(raw)?raw:[raw];
          arr.forEach(function(v){values.push(typeof v==='string'?v.trim():v==null?'':null);});
        });
        if(values.some(function(v){return v===null;})||
           values.some(function(v){return v!==values[0];}))return {invalid:true,value:''};
        return {invalid:false,value:values[0]||''};
      }
      var h=header('cts'),flag=header('cts_flag'),f=flag.value.toUpperCase();
      var keyClass=h.value?'HEADER':'ABSENT',flagClass=f==='Y'?'Y':f==='N'?'N':f?'OTHER':'ABSENT';
      // Legacy body keys are recognized only as evidence of possible additional
      // data. They remain internal and are never sent back upstream by this probe.
      var bodyKey=false,bodyInvalid=false;
      function inspect(o){
        if(!o||typeof o!=='object'||Array.isArray(o))return;
        Object.keys(o).forEach(function(k){
          if(!/^(?:cts|ctsz\d+)$/i.test(k))return;
          var v=o[k];
          if(v==null||v==='')return;
          if(typeof v!=='string'){bodyInvalid=true;return;}
          if(v.trim())bodyKey=true;
        });
      }
      inspect(body);
      Object.keys(body||{}).forEach(function(k){
        if(!/^Output_\d+$/i.test(k))return;
        var block=body[k];if(Array.isArray(block))block.forEach(inspect);else inspect(block);
      });
      if(!h.value&&bodyKey)keyClass='BODY';
      var state='UNVERIFIED';
      if(!h.invalid&&!flag.invalid&&!bodyInvalid&&flagClass!=='OTHER'){
        var hasKey=keyClass!=='ABSENT',continueCode=['00165','00218','XA109'].includes(code);
        if(flagClass==='N')state='LAST';
        else if(flagClass==='Y')state=hasKey?'NEXT':'UNVERIFIED';
        else if(continueCode)state=hasKey?'NEXT':'UNVERIFIED';
        else if(keyClass==='BODY')state='NEXT';
        else state='LAST'; // header key alone does not establish another page
      }
      return {keyClass:keyClass,flagClass:flagClass,state:state};
    }
