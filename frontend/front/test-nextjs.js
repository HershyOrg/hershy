const fs = require('fs')

fetch('http://localhost:3000')
  .then(res => res.text())
  .then(text => {
     if(text.includes('AIPanel') || text.includes('AI 전략 생성 콜라보레이터')) {
         console.log("AIPanel text is found in response.")
     } else {
         console.log("AIPanel text is NOT found in response.")
     }
  })
  .catch(err => {
     console.error('Fetch error:', err.message)
  })
