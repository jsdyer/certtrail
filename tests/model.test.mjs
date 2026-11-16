import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nameCounts, parseDomain, queryURL, summarize, toCSV, validity, yearCounts} from '../web/model.mjs';

test('accepts DNS names and IDNs and produces the crt.sh identity query', () => {
  assert.equal(parseDomain(' BÜCHER.de. '), 'xn--bcher-kva.de');
  for (const value of ['*.example.com','https://example.com','example.com/a','-example.com','127.0.0.1','example.com:443','localhost']) {
    assert.equal(parseDomain(value),null,value);
  }
  assert.equal(queryURL('example.com'),'https://crt.sh/?q=%25.example.com&output=json');
});

test('deduplicates same-issuer serials and filters scoped names on label boundaries', () => {
  const base = {issuer_ca_id: 43, issuer_name: 'issuer', serial_number: 'abcd',
    name_value: 'example.com\na.example.com\nexample.com.other.org\n*.zone.example.com', not_before:'2022-02-07T14:09:23',
    not_after:'2022-05-07T14:09:23'};
  const items = summarize([{...base,id: 144}, {...base,id: 145}, {...base,id: 146,issuer_ca_id: 44},
    {...base,id:155,name_value: 'fake-example.com'}], 'example.com');
  assert.equal(items.length,2);
  assert.deepEqual(items[0].names,['*.zone.example.com','a.example.com','example.com']);
  assert.equal(items[0].notBefore,'2022-02-07T14:09:23.000Z');
  assert.equal(validity(items[0],'2025-01-01'),'expired');
  assert.equal(nameCounts(items)[0][1],2);
  assert.deepEqual(yearCounts(items),[['2022',2]]);
});

test('guards CSV exports and invalid local payloads', () => {
  const rows = summarize([{id: 3, issuer_name:'  =SUM(1,2)', name_value:'a.example.com'}],'example.com');
  assert.match(toCSV(rows), /"'=SUM\(1,2\)"/);
  assert.throws(() => summarize({records:[]},'example.com'),/JSON array/);
});
