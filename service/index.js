'use strict';

require('babel/register');

import * as Async from 'async';
import * as GithubAPI from 'octonode';
import parse from 'parse-link-header';
import * as Database from './database';
import merge from 'lodash-node/modern/object/merge';
import pick from 'lodash-node/modern/object/pick';

import bunyan from 'bunyan';

var logger = bunyan.createLogger({name: 'gander'});

const ORGS = require('../../app').organizations;
const ACCESS_TOKEN = require('../../app').githubAccessToken;

const PUBLIC_TYPE = 'public';
const STATE_OPEN = 'open';

var client = GithubAPI.client(ACCESS_TOKEN);
client.requestDefaults['headers'] = {
  'user-agent': 'Gander'
};


function getAllRepos(org, withOptions, whenDone) {

  var attrsToPick = [
    'id',
    'name',
    'full_name',
    'html_url',
    'description',
    'created_at',
    'updated_at',
    'pushed_at',
    'stargazers_count',
    'watchers_count',
    'language',
    'has_issues',
    'forks_count',
    'open_issues_count',
    'watchers'
  ];

  getAll('/orgs/' + org + '/repos', withOptions, attrsToPick, whenDone);
}

function getAllIssues(org, withOptions, whenDone) {

  var attrsToPick = [
    'title',
    'created_at',
    'updated_at',
    'comments',
    'repository',
    'pull_request',
    'description'
  ];

  getAll('/orgs/' + org + '/issues', withOptions, attrsToPick, whenDone);
}

function getAll(url, withOptions, attrsToPick, whenDone) {

  var results = [];

  var defaultOptions = {
    per_page: 100,
    page: 0
  };

  function pickedResults() {
    return results.map(function(result) {
      return pick(result, attrsToPick);
    });
  }

  var options = merge(defaultOptions, withOptions);

  function get(done) {
    options.page += 1;
    client.get(url, options, done);
  }

  function handler(err, statusCode, data, headers) {

    if (err) {
      return whenDone(err);
    }

    results = results.concat(data);

    if (!headers.link) {
      return whenDone(null, pickedResults());
    }

    if (typeof parse(headers.link).last === 'undefined') {
      whenDone(null, pickedResults());
    }
    else {
      get(handler);
    }

  }

  get(handler);
}

function getRepoAndIssues(org, done) {

  Async.parallel([

    function(callback) {

      getAllRepos(org, {
        type: PUBLIC_TYPE
      }, callback);
    },

    function(callback) {

      getAllIssues(org, {
        state: STATE_OPEN,
        filter: 'all'
      }, callback);
    }

  ], done);
}

function mashReposWithIssues(repos, issues) {

  // init the computed property
  repos.map(function(repo) {
    repo.computed = {
      issues: [],
      pull_requests: []
    };
  });

  issues.map(function(issue) {

    let index = repos.findIndex(function(repo) {
      return repo.name === issue.repository.name;
    });

    let repo = repos[index];
    delete issue.repository;

    // push the issue into the appropriate bucket
    repo.computed[issue.pull_request ? 'pull_requests' : 'issues'].push(issue);
  });

  return repos;
}

export function sync() {

  function iterator(org, callback) {

    getRepoAndIssues(org, function(err, results) {
      if (err) {
        return callback(err);
      }

      Database.saveReposWithIssues(org,
        mashReposWithIssues(results[0], results[1]),
        callback);
    });
  }

  Async.eachSeries(ORGS, iterator, function(err) {
    if (err) {
      return logger.error(err);
    }
  });
}

export function fetch(org, callback) {

  Database.readReposWithIssues(org, callback);
}

export function fetchAll(callback) {

  var results = [];

  function iterator(org, itCallback) {

    fetch(org, function(err, obj) {
      if (err) {
        return itCallback(err);
      }

      results.push(obj);
      itCallback();
    });

  }

  Async.eachSeries(ORGS, iterator, function(err) {
    callback(err, results);
  });
}

export function fetchAllIssues(callback) {

  fetchAll(function(err, results) {

    if (err) {
      return callback(err);
    }

    results = results.map(function(result) {
      delete result.repos;
      return result;
    });

    callback(null, results);
  });
}