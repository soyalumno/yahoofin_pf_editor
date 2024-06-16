console.log('Yahoo Finance Portfolio Editor Extension loaded.');

const fetchLocal = async (key) => (
  new Promise((res) => chrome.storage.local.get(key, (data) => res(data[key])))
);
const updateLocal = (key, value) => (
  chrome.storage.local.set({[key]: value})
);

/**
 * @param {string} method - CRUDメソッド
 * @param {Record<string, string> | undefined} option - オプション
 * @return {any}
 */
const crudPortfolio = async (method, option = {}) => {
  const {
    purchasePrice,
    retentionNumber,
    memo
  } = option;
  let code = option.code;
  const pageInfo = await fetchLocal('pageInfo');
  const portfolios = await fetchLocal('portfolios');
  const retentionOrder = portfolios.findIndex((p) => p.code === code) + 1;

  // コードが東証の場合は末尾に'.T'を付与
  code?.match(/^\d{4}$/) && (code = code + '.T');

  let body = {
    id: `${method}PortfolioDetail`,
    params: {
      portfolioId: new URL(location.href).searchParams.get('portfolioId'),
    }
  };
  if(!method.match(/get/i)) {
    body.params = {
      ...body.params,
      csrfToken: pageInfo.csrfToken,
      crumbName: 'portfolio_detail',
    };
  }

  switch(method.toLowerCase()) {
    case 'get':
      body.params = {
        ...body.params,
        prPublishStatus: 'published',
        apologyPublishStatus: 'published'
      };
      break;
    case 'add':
      body.params= {
        ...body.params,
        code,
      };
      break;
    case 'edit':
      body.params= {
        ...body.params,
        body: {
          code,
          purchasePrice,
          retentionNumber,
          memo,
        },
        retentionOrder,
      };
      break;
    case 'delete':
      body.params = {
        ...body.params,
        code,
        retentionOrder,
      }
      break;
    default:
      throw new Error('Invalid method');
      break;
  }

  /**
   * @param {Record<string, any>} body - リクエストボディ
   */
  const ajaxProc = async (body) => {
    return new Promise(async (resolve) => {
      const pageInfo = await fetchLocal('pageInfo');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://finance.yahoo.co.jp/portfolio/ajax', true);
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4 && xhr.status === 200)
          resolve(xhr.responseText);
      };
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('X-Z-Jwt-Token', pageInfo.jwtToken);
      console.log('%o', body);
      xhr.send(JSON.stringify(body));
    });
  };

  // execute ajax
  const resp = await ajaxProc(body);
  const json = JSON.parse(resp);
  console.log('%o', json);

  // update local storage
  if(!method.match(/get/i)) {
    updateLocal('portfolios', (await crudPortfolio('get')).portfolio.portfolioDetails);
    console.log(await fetchLocal('portfolios'));
  }
  return json;
};

const onClick = async () => {
  const lines = document.querySelector('textarea#csv').value.split('\n').filter(l => l.match(/^\d{4}/));
  if(!lines.length) {
    alert('有効なデータがありません');
    throw new Error('No data');
  }

  const btn = document.querySelector('button#update');
  btn.disabled = true;

  // popup toast
  const toast = document.createElement('div');
  toast.className = 'yahoo-pf-editor yahoo-pf-editor-toast';
  toast.textContent = '初期化中...';
  document.body.appendChild(toast);

  try {
    const portfolios = (await crudPortfolio('get')).portfolio.portfolioDetails;
    // delete second and later
    for(const p of portfolios.slice(1)) {
      toast.textContent = `初期化中...${parseInt(portfolios.indexOf(p)) + 1}/${portfolios.length}`;
      await crudPortfolio('delete', {code: p.code});
    }
    // add dummy
    await crudPortfolio('add', {code: 'XXX'});
    // delete first
    await crudPortfolio('delete', {code: portfolios[0].code});

    let hasDeleted = false;
    for(const i in lines.slice(0, 50)) {
      const line = lines[i];
      const [
        code,
        ,
        num,
        price
      ] = line.split('\t');

      const options = {
        code,
        purchasePrice: price.replace(/,/g, ''),
        retentionNumber: num.replace(/,/g, ''),
        memo: portfolios.find((p) => p.code === code)?.memo || '',
      };
      toast.textContent = '更新中...\n' + (parseInt(i) + 1) + '/' + lines.slice(0, 50).length;
      await crudPortfolio('add', options);
      await crudPortfolio('edit', options);

      // disp rest codes
      const rest = lines.slice(parseInt(i) + 1).join('\n');
      updateLocal('rest', rest);
      document.querySelector('textarea#csv').value = rest;

      // delete dummy
      if(!hasDeleted) {
        await crudPortfolio('delete', {code: 'XXX'});
        hasDeleted = true;
      }
    }

    // sleep
    toast.textContent = '更新完了 ページを更新します';
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(2000);

    const fadeOut = (elem) => {
      return new Promise((resolve) => {
        let opacity = 1;
        const fadeOutInterval = setInterval(() => {
          if (opacity < 0.2) {
            clearInterval(fadeOutInterval);
            elem.style.opacity = 1;
            elem.style.display = 'none';
            resolve();
          } else {
            opacity -= 0.08;
            elem.style.opacity = opacity;
          }
        }, 20);
      });
    };
    await fadeOut(toast);

    // reload page
    location.reload();
  } catch (e) {
    /* handle error */
    toast.style.display = 'none';
    alert(e.message);
    btn.disabled = false;
    throw e;
  }
};

async function addDandD() {
  // ドラッグアンドドロップ用のエリアを作成
  const area = document.createElement('div');
  area.className = 'yahoo-pf-editor yahoo-pf-editor-dd';
  area.id = 'drop-area';
  area.innerText = 'ファイルをここにドラッグ&ドロップ';

  // ドラッグイベントのリスナーを追加
  area.addEventListener('dragover', (event) => {
    event.preventDefault();
    area.style.borderColor = '#333';
  });

  area.addEventListener('dragleave', () => {
    area.style.borderColor = '#ccc';
  });

  area.addEventListener('drop', async (event) => {
    event.preventDefault();
    area.style.borderColor = '#ccc';
    const [file] = event.dataTransfer.files;
    if (file.type !== 'text/csv') {
      alert('ファイルタイプが不正です');
      throw new Error('Invalid file type');
    }

    console.log(file.name);
    const readfile = (file, encoding = 'Shift_JIS') => {
      return new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = (event) => resolve(event.target.result);
        fr.readAsText(file, encoding);
      });
    };
    const text = await readfile(file);
    let security = '';
    if(text.match(/銘柄コード,銘柄名称,保有株数,売却注文中,取得単価,現在値,取得金額,評価額,評価損益/)) {
      security = 'sbi';
    } else if(!text.match(/\\"種別\\",\\"銘柄コード・ティッカー\\"/)) {
      security = 'rakuten';
    } else {
      alert('CSVファイルの形式が未知です');
      throw new Error('Invalid CSV file');
    }
    console.log('sec : ' + security);

    let head = [];
    const portfolios = [];
    for(const line of text.split('\n')) {
      const cells = line.match(/"[^"]+"|[^,]+/g);
      if(cells?.length > 2) {
        if(line.match(/コード.+取得/)) {
          head = cells.map((c) => c.replace(/"/g, '').trim());
        } else if(head.length) {
          portfolios.push(
            cells.reduce((acc, value, i) => {
              acc[head[i]] = value.replace(/"/g, '').trim();
              return acc;
            }, {})
          );
        }
      } else if(head.length) {
        break;
      }
    }
    console.log('%o', portfolios);
    document.querySelector('textarea#csv').value = portfolios
      .filter((p) => (p['銘柄コード'] || p['銘柄コード・ティッカー']).match(/^\d{4}$/))
      .map((p) => (
        security === 'sbi' ?
          [p['銘柄コード'], p['銘柄名称'], p['保有株数'], p['取得単価']].join('\t'):
          [p['銘柄コード・ティッカー'], p['銘柄'], p['保有数量'], p['平均取得価額']].join('\t')
      )).join('\n');
    updateLocal('rest', '');
  });

  // ドロップエリアをbodyに追加
  const body = document.querySelector('body');
  body.appendChild(area);

  const textarea = document.createElement('textarea');
  textarea.id = 'csv';
  textarea.className = 'yahoo-pf-editor yahoo-pf-editor-textarea';
  textarea.wrap = 'off';
  // 前回の残りの銘柄を復元
  textarea.value = (await fetchLocal('rest')) || '';
  body.appendChild(textarea);

  const btn = document.createElement('button');
  btn.id = 'update';
  btn.className = 'yahoo-pf-editor yahoo-pf-editor-btn';
  btn.textContent = '一括更新';
  btn.addEventListener('click', onClick);
  body.appendChild(btn);

  if((await fetchLocal('enabled')) === false)
    document.querySelectorAll('.yahoo-pf-editor').forEach((tag) => tag.style.display = 'none');
}

/*
const onCrudOperation = async () => {
  const method = document.querySelector('input#method').value;
  await crudPortfolio(method, {
    code: document.querySelector('input#code').value,
    purchasePrice: (document.querySelector('input#purchasePrice').value || ''),
    retentionNumber: (document.querySelector('input#retentionNumber').value || ''),
    memo: document.querySelector('input#memo').value
  });
  // reload page
  // location.reload();
};

function addCrudOperation() {
  const section = document.querySelector('section#PortfolioDetail > div');
  if (section) {
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.justifyContent = 'left';
    div.style.margin = '5px 10px';

    const btn = document.createElement('button');
    btn.textContent = 'CRUD Operation';
    btn.style.backgroundColor = '#017fff';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.padding = '10px 10px';
    btn.style.borderRadius = '5px';
    btn.addEventListener('click', onCrudOperation);
    div.appendChild(btn);

    ['method', 'code', 'purchasePrice', 'retentionNumber', 'memo'].forEach((key) => {
      const input = document.createElement('input');
      input.id = key;
      input.type = 'text';
      input.placeholder = key;
      input.style.marginLeft = '10px';
      input.style.border = '1px solid #ccc';
      input.style.padding = '5px 10px';
      div.appendChild(input);
    });
    section.appendChild(div);
  }
}
*/

window.addEventListener('load', async () => {
  // get page info
  const state = JSON.parse(document.querySelector('div#adScript > script')?.textContent.match(/.+?(\{.+)/)[1])
  for(const key of Object.keys(state)) {
    updateLocal(key, state[key]);
    if(key === 'portfolioDetail') {
      updateLocal('portfolios', state[key].portfolio.portfolioDetails);
    }
  }
  console.log(await fetchLocal('pageInfo'));
  console.log(await fetchLocal('portfolios'));

  addDandD();
});

