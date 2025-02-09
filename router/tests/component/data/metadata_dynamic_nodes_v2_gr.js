/**
 * run 1 node on the current host
 *
 * - 1 PRIMARY
 *
 * via HTTP interface
 *
 * - md_query_count
 */

var common_stmts = require("common_statements");
var gr_memberships = require("gr_memberships");

if (mysqld.global.gr_node_host === undefined) {
  mysqld.global.gr_node_host = "127.0.0.1";
}


if (mysqld.global.gr_id === undefined) {
  mysqld.global.gr_id = "uuid";
}

if (mysqld.global.gr_nodes === undefined) {
  mysqld.global.gr_nodes = [];
}

if (mysqld.global.cluster_nodes === undefined) {
  mysqld.global.cluster_nodes = [];
}

if (mysqld.global.notices === undefined) {
  mysqld.global.notices = [];
}

if (mysqld.global.md_query_count === undefined) {
  mysqld.global.md_query_count = 0;
}

if (mysqld.global.transaction_count === undefined) {
  mysqld.global.transaction_count = 0;
}

if (mysqld.global.primary_id === undefined) {
  mysqld.global.primary_id = 0;
}

if (mysqld.global.mysqlx_wait_timeout_unsupported === undefined) {
  mysqld.global.mysqlx_wait_timeout_unsupported = 0;
}

if (mysqld.global.gr_notices_unsupported === undefined) {
  mysqld.global.gr_notices_unsupported = 0;
}

if (mysqld.global.cluster_type === undefined) {
  mysqld.global.cluster_type = "gr";
}

if (mysqld.global.cluster_name === undefined) {
  mysqld.global.cluster_name = "test";
}

if (mysqld.global.gr_pos === undefined) {
  mysqld.global.gr_pos = 0;
}

if (mysqld.global.server_version === undefined) {
  // Let's keep the default server version as some known compatible version.
  // If there is a need to some specific compatibility checks, this should be
  // overwritten from the test.
  mysqld.global.server_version = "8.0.39";
}

var members = gr_memberships.gr_members(
    mysqld.global.gr_node_host, mysqld.global.gr_nodes);

const online_gr_nodes = members
                            .filter(function(memb, indx) {
                              return (memb[3] === "ONLINE");
                            })
                            .length;

const recovering_gr_nodes = members
                                .filter(function(memb, indx) {
                                  return (memb[3] === "RECOVERING");
                                })
                                .length;

const member_state = members[mysqld.global.gr_pos] ?
    members[mysqld.global.gr_pos][3] :
    undefined;

var options = {
  group_replication_members: members,
  gr_member_state: member_state,
  gr_members_all: members.length,
  gr_members_online: online_gr_nodes,
  gr_members_recovering: recovering_gr_nodes,
  innodb_cluster_instances: gr_memberships.cluster_nodes(
      mysqld.global.gr_node_host, mysqld.global.cluster_nodes),
  gr_id: mysqld.global.gr_id,
  cluster_type: mysqld.global.cluster_type,
  innodb_cluster_name: mysqld.global.cluster_name,
};

if (mysqld.global.primary_id >= 0) {
  options.group_replication_primary_member =
      options.group_replication_members[mysqld.global.primary_id][0];
}

// prepare the responses for common statements
var common_responses = common_stmts.prepare_statement_responses(
    [
      "router_set_session_options",
      "router_set_gr_consistency_level",
      "router_select_cluster_type_v2",
      "select_port",
      "router_commit",
      "router_rollback",
      "router_select_schema_version",
      "router_check_member_state",
      "router_select_members_count",
      "router_select_group_replication_primary_member",
      "router_select_group_membership_with_primary_mode",
      "router_update_last_check_in_v2",
      "router_clusterset_present",
    ],
    options);

var common_responses_regex = common_stmts.prepare_statement_responses_regex(
    [
      "router_update_attributes_v2",
      "router_update_last_check_in_v2",
    ],
    options);

var router_select_metadata =
    common_stmts.get("router_select_metadata_v2_gr", options);

var router_start_transaction =
    common_stmts.get("router_start_transaction", options);

({
  handshake: {
    auth: {
      username: mysqld.global.user,
      password: mysqld.global.password,
    },
    greeting: {server_version: mysqld.global.server_version}
  },
  stmts: function(stmt) {
    if (common_responses.hasOwnProperty(stmt)) {
      return common_responses[stmt];
    } else if (
        (res = common_stmts.handle_regex_stmt(stmt, common_responses_regex)) !==
        undefined) {
      return res;
    } else if (stmt === router_start_transaction.stmt) {
      mysqld.global.transaction_count++;
      return router_start_transaction;
    } else if (stmt === router_select_metadata.stmt) {
      mysqld.global.md_query_count++;
      return router_select_metadata;
    } else if (stmt === "set @@mysqlx_wait_timeout = 28800") {
      if (mysqld.global.mysqlx_wait_timeout_unsupported === 0) return {
          ok: {}
        }
      else
        return {
          error: {
            code: 1193,
            sql_state: "HY001",
            message: "Unknown system variable 'mysqlx_wait_timeout'"
          }
        }
    } else if (stmt === "enable_notices") {
      if (mysqld.global.gr_notices_unsupported === 0) return {
          ok: {}
        }
      else
        return {
          error: {
            code: 5163,
            sql_state: "HY001",
            message:
                "Invalid notice name group_replication/membership/quorum_loss"
          }
        }
    } else if (stmt === "SHOW STATUS LIKE 'Ssl_session_cache_hits'") {
      return {
        result: {
          columns: [{name: "Ssl_session_cache_hits", type: "LONG"}],
          rows: [[mysqld.session.ssl_session_cache_hits]]
        }
      }
    } else {
      return common_stmts.unknown_statement_response(stmt);
    }
  },
  notices: (function() {
    return mysqld.global.notices;
  })()
})
