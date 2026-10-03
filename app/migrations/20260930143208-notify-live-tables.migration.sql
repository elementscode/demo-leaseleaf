-- notify live tables
--
-- Payments land from the Stripe return page, the webhook and the autopay job,
-- none of which write through a view. These triggers make every write to the
-- watched tables a broadcast, whatever its source. The payload is only the id:
-- each app server reads the row back through the view's own select, which
-- carries the joined tenant, unit and building columns.

create or replace function notifyLive(tableName text, op text, rowId uuid, partitions text[])
returns void
language plpgsql
as $$
declare
  payload text := json_build_object('op', op, 'id', rowId)::text;
  p text;
begin
  perform pg_notify(channel_name(tableName), payload);

  foreach p in array partitions loop
    perform pg_notify(channel_name(tableName || ':' || p), payload);
  end loop;
end;
$$;

create or replace function rentChargesNotify()
returns trigger
language plpgsql
as $$
declare
  r record := coalesce(new, old);
begin
  perform notifyLive('rentCharges', lower(tg_op), r.id, array[
    'month=' || r.month,
    'leaseId=' || r.leaseId
  ]);

  return r;
end;
$$;

create trigger rentChargesNotifyTrigger
  after insert or update or delete on rentCharges
  for each row execute function rentChargesNotify();

-- the rent roll shows autopay per row, so a lease change repaints its charges
create or replace function leasesNotify()
returns trigger
language plpgsql
as $$
declare
  c record;
begin
  for c in select id, month, leaseId from rentCharges where leaseId = new.id loop
    perform notifyLive('rentCharges', 'update', c.id, array[
      'month=' || c.month,
      'leaseId=' || c.leaseId
    ]);
  end loop;

  return new;
end;
$$;

create trigger leasesNotifyTrigger
  after update on leases
  for each row execute function leasesNotify();

create or replace function notifyRequest(op text, requestId uuid)
returns void
language plpgsql
as $$
declare
  t uuid;
begin
  select tenantId into t from maintenanceRequests where id = requestId;

  if t is null then
    return;
  end if;

  perform notifyLive('maintenanceRequests', op, requestId, array[
    'tenantId=' || t,
    'id=' || requestId
  ]);
end;
$$;

create or replace function maintenanceRequestsNotify()
returns trigger
language plpgsql
as $$
declare
  r record := coalesce(new, old);
begin
  perform notifyLive('maintenanceRequests', lower(tg_op), r.id, array[
    'tenantId=' || r.tenantId,
    'id=' || r.id
  ]);

  return r;
end;
$$;

create trigger maintenanceRequestsNotifyTrigger
  after insert or update or delete on maintenanceRequests
  for each row execute function maintenanceRequestsNotify();

-- a new photo or comment changes the counts shown on the request's card
create or replace function maintenanceChildNotify()
returns trigger
language plpgsql
as $$
declare
  r record := coalesce(new, old);
begin
  perform notifyRequest('update', r.requestId);

  return r;
end;
$$;

create trigger maintenancePhotosNotifyTrigger
  after insert or delete on maintenancePhotos
  for each row execute function maintenanceChildNotify();

create trigger maintenanceCommentsNotifyTrigger
  after insert or delete on maintenanceComments
  for each row execute function maintenanceChildNotify();

create or replace function maintenanceCommentsNotify()
returns trigger
language plpgsql
as $$
declare
  r record := coalesce(new, old);
begin
  perform notifyLive('maintenanceComments', lower(tg_op), r.id, array[
    'requestId=' || r.requestId
  ]);

  return r;
end;
$$;

create trigger maintenanceCommentsLiveTrigger
  after insert or update or delete on maintenanceComments
  for each row execute function maintenanceCommentsNotify();
