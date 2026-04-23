import fetch from 'node-fetch'

const BASE_URL = 'http://localhost:3000'
const test_chatId = '595491234567@c.us'

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
}

function log(type, message) {
  const typeColor = {
    PASS: colors.green,
    FAIL: colors.red,
    INFO: colors.blue,
    TEST: colors.yellow,
  }[type] || colors.reset

  console.log(`${typeColor}[${type}]${colors.reset} ${message}`)
}

async function testWebhook(payload, description) {
  log('TEST', `Testing: ${description}`)
  try {
    const res = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      log('PASS', `Webhook accepted for: ${description}`)
      return true
    } else {
      log('FAIL', `Webhook rejected (${res.status}): ${description}`)
      return false
    }
  } catch (e) {
    log('FAIL', `Error: ${e.message}`)
    return false
  }
}

async function testHealth() {
  log('TEST', 'Checking server health')
  try {
    const res = await fetch(`${BASE_URL}/health`)
    const data = await res.json()
    if (data.ok) {
      log('PASS', `Server is running on port 3000`)
      log('INFO', `Model: ${data.model}`)
      log('INFO', `Knowledge base: ${data.knowledgeBase ? 'loaded' : 'missing'}`)
      log('INFO', `Anthropic key: ${data.anthropicKeySet ? 'set' : 'missing'}`)
      return true
    }
  } catch (e) {
    log('FAIL', `Health check failed: ${e.message}`)
    return false
  }
}

// Test payloads
const payloads = {
  // Test 1: REPROCANN with both sides in one image
  reprocannBothSides: {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'imageMessage',
      downloadUrl: 'https://example.com/reprocann-both-sides.jpg',
      idMessage: 'msg_test_1',
    },
    senderData: {
      chatId: '595491111111@c.us',
      senderName: 'TestUser1_BothSides',
    },
  },

  // Test 2: REPROCANN frente only
  reprocannFrente: {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'imageMessage',
      downloadUrl: 'https://example.com/reprocann-frente.jpg',
      idMessage: 'msg_test_2a',
    },
    senderData: {
      chatId: '595491222222@c.us',
      senderName: 'TestUser2_TwoImages',
    },
  },

  // Test 2b: REPROCANN dorso
  reprocannDorso: {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'imageMessage',
      downloadUrl: 'https://example.com/reprocann-dorso.jpg',
      idMessage: 'msg_test_2b',
    },
    senderData: {
      chatId: '595491222222@c.us',
      senderName: 'TestUser2_TwoImages',
    },
  },

  // Test 3: Text message for field completion
  textFieldResponse: {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: {
        textMessage: 'Buenos Aires',
      },
      idMessage: 'msg_test_3a',
    },
    senderData: {
      chatId: '595491333333@c.us',
      senderName: 'TestUser3_TextFields',
    },
  },

  // Test 4: DNI image
  dniImage: {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'imageMessage',
      downloadUrl: 'https://example.com/dni.jpg',
      idMessage: 'msg_test_4',
    },
    senderData: {
      chatId: '595491444444@c.us',
      senderName: 'TestUser4_Complete',
    },
  },

  // Test 5: Non-document image
  randomImage: {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'imageMessage',
      downloadUrl: 'https://example.com/random-picture.jpg',
      idMessage: 'msg_test_5',
    },
    senderData: {
      chatId: '595491555555@c.us',
      senderName: 'TestUser5_Random',
    },
  },

  // Test 6: Normal text message
  textMessage: {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: {
        textMessage: '¿Cuáles son los horarios?',
      },
      idMessage: 'msg_test_6',
    },
    senderData: {
      chatId: '595491666666@c.us',
      senderName: 'TestUser6_TextQuestion',
    },
  },

  // Test 7: Rate limit test (many messages)
  generateRateLimitMessages: (count) => {
    const messages = []
    for (let i = 0; i < count; i++) {
      messages.push({
        typeWebhook: 'incomingMessageReceived',
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: {
            textMessage: `Mensaje ${i + 1}`,
          },
          idMessage: `msg_ratelimit_${i}`,
        },
        senderData: {
          chatId: '595491777777@c.us',
          senderName: 'TestUser7_RateLimit',
        },
      })
    }
    return messages
  },
}

async function runTests() {
  console.log('\n' + colors.blue + '=== WhatsApp Bot v2.0 - Test Suite ===' + colors.reset + '\n')

  // Health check
  const healthOk = await testHealth()
  if (!healthOk) {
    log('FAIL', 'Server not responding. Aborting tests.')
    return
  }

  console.log('\n' + colors.blue + '=== Webhook Tests ===' + colors.reset + '\n')

  // Test 1: REPROCANN with both sides
  await testWebhook(
    payloads.reprocannBothSides,
    'REPROCANN with both sides in one image'
  )

  // Test 2: REPROCANN two images
  await testWebhook(
    payloads.reprocannFrente,
    'REPROCANN frente only (expecting dorso next)'
  )
  await testWebhook(
    payloads.reprocannDorso,
    'REPROCANN dorso (completing two-image flow)'
  )

  // Test 3: Text field completion
  await testWebhook(
    payloads.textFieldResponse,
    'Text message for field completion'
  )

  // Test 4: DNI
  await testWebhook(
    payloads.dniImage,
    'DNI image (should trigger completion & email)'
  )

  // Test 5: Random image
  await testWebhook(
    payloads.randomImage,
    'Non-document image (should ask for REPROCANN or DNI)'
  )

  // Test 6: Normal text
  await testWebhook(
    payloads.textMessage,
    'Normal text question (should use Claude)'
  )

  // Test 7: Rate limiting
  console.log('\n' + colors.blue + '=== Rate Limiting Test ===' + colors.reset + '\n')
  const rateLimitMessages = payloads.generateRateLimitMessages(35)
  let blockedCount = 0
  for (let i = 0; i < rateLimitMessages.length; i++) {
    const msg = rateLimitMessages[i]
    const res = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    })
    if (i < 30 && res.ok) {
      if (i % 5 === 0) log('INFO', `Message ${i + 1}: Accepted`)
    } else if (i >= 30 && !res.ok) {
      blockedCount++
      if (blockedCount === 1) log('PASS', `Message ${i + 1}: Blocked (rate limit working)`)
    }
  }
  if (blockedCount >= 5) {
    log('PASS', `Rate limiting working: ${blockedCount} messages blocked after limit`)
  }

  console.log('\n' + colors.blue + '=== Test Summary ===' + colors.reset + '\n')
  log('INFO', 'All webhook endpoints tested')
  log('INFO', 'Check logs above for PASS/FAIL status')
  log('INFO', 'For Claude Vision tests, see server logs for image analysis')
}

// Run tests
runTests().catch(e => log('FAIL', `Test suite error: ${e.message}`))
